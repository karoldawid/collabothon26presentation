import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/api';
import { clearStoredActiveMatch, readStoredMatch, writeStoredMatch } from '@/lib/duel/activeMatch';
import { haptic, playSound } from '@/lib/duel/feedback';
import { createInitialDuelState, duelReducer, type DuelMatchState } from '@/lib/duel/reducer';
import { useDuelSocket } from '@/lib/duel/useDuelSocket';
import { useCurrentUser } from '@/lib/user';
import type {
  AnswerRequest,
  AnswerResult,
  DuelAnswer,
  DuelMode,
  DuelSocketMessage,
  PlayerCard,
  MatchEnd,
  MatchStart,
  MatchState,
  StartMatchRequest,
} from '@/types/duel';

const FEEDBACK_AUTO_ADVANCE_MS = 3000;
const COUNTDOWN_TICK_MS = 250;
const POLL_INTERVAL_MS = 1000;
const FINDING_RIVAL_MS = 1500;
/** How long to wait for the live socket to open before falling back to the simulated rival. */
const SOCKET_OPEN_WAIT_MS = 3000;
/** Upper bound for the whole live search; the server answers `no-rival` after its queue timeout (15 s by default). */
const LIVE_SEARCH_MAX_MS = 20_000;
/** How long the "Rival found!" versus intro stays up before the first question. */
const MATCHED_INTRO_MS = 1800;
/** Shown until the first countdown tick of a question replaces it. */
const INITIAL_SECONDS_LEFT = 30;

export type UseDuelMatchParams = {
  categories: string[];
  mode: DuelMode;
  reloadMatchId?: number;
};

/** The live rival search shown by the matchmaking view. */
export type MatchSearch = {
  phase: 'searching' | 'matched' | 'fallback';
  /** Epoch ms when the server gives up searching (the countdown ring); null until `queued`. */
  deadline: number | null;
  /** The server's whole search time in ms, from `queued`; null until then. */
  searchMs: number | null;
  rival: PlayerCard | null;
};

type LiveSearchResult =
  | { kind: 'matched'; matchId: number; rival: PlayerCard }
  | { kind: 'no-rival' }
  | { kind: 'unavailable' };

export type UseDuelMatchResult = {
  state: DuelMatchState;
  search: MatchSearch;
  secondsLeft: number;
  submitAnswer: (answer: DuelAnswer) => void;
  nextQuestion: () => void;
  leave: () => void;
  retry: () => void;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useDuelMatch({
  categories,
  mode,
  reloadMatchId,
}: UseDuelMatchParams): UseDuelMatchResult {
  const { userId, deviceId } = useCurrentUser();
  const [search, setSearch] = useState<MatchSearch>({ phase: 'searching', deadline: null, searchMs: null, rival: null });
  const searchWaiterRef = useRef<((message: DuelSocketMessage) => void) | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [state, dispatch] = useReducer(duelReducer, undefined, () => {
    const stored = !reloadMatchId ? readStoredMatch(categories, mode, userId) : null;
    return createInitialDuelState(
      categories,
      mode,
      stored ? { matchId: stored.matchId, yourDots: stored.yourDots } : undefined,
    );
  });
  const [secondsLeft, setSecondsLeft] = useState(INITIAL_SECONDS_LEFT);

  const latestRef = useRef(state);
  useEffect(() => {
    latestRef.current = state;
  }, [state]);

  const answeringRef = useRef(false);

  // Persist active match in sessionStorage
  useEffect(() => {
    if (state.error?.code === 'MATCH_NOT_FOUND') {
      clearStoredActiveMatch(userId);
      return;
    }
    if (state.matchId !== null && state.phase !== 'result') {
      writeStoredMatch({
        matchId: state.matchId,
        categories: state.categories,
        mode: state.mode,
        yourDots: state.yourDots,
      }, userId);
    } else if (state.phase === 'result') {
      clearStoredActiveMatch(userId);
    }
  }, [state.matchId, state.categories, state.mode, state.yourDots, state.phase, state.error, userId]);

  const fetchResult = useCallback(async (matchId: number) => {
    try {
      const res = await api<MatchEnd>(`/api/duel/matches/${matchId}?userId=${encodeURIComponent(userId)}`);
      dispatch({ type: 'match.end', result: res });
      clearStoredActiveMatch(userId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Not finished yet
        return;
      }
      dispatch({
        type: 'error',
        code: 'RESULT_ERROR',
        message: err instanceof Error ? err.message : 'Failed to load result',
      });
    }
  }, [userId]);

  const handleSocketMessage = useCallback(
    (message: DuelSocketMessage) => {
      searchWaiterRef.current?.(message);
      const current = latestRef.current;
      if (current.matchId === null) return;
      if (message.type === 'rival-progress' && message.matchId === current.matchId) {
        dispatch({
          type: 'rival.progress',
          rivalProgress: {
            answered: message.answered,
            results: Array.from({ length: current.questionCount }, (_, i) => message.results[i] ?? null),
          },
        });
      } else if (message.type === 'rival-finished' && message.matchId === current.matchId) {
        if (latestRef.current.phase === 'waiting') void fetchResult(current.matchId);
      } else if (message.type === 'rival-left' && message.matchId === current.matchId) {
        dispatch({ type: 'rival.left' });
      }
    },
    [fetchResult],
  );

  const liveEnabled = mode === 'HUMAN' && Boolean(deviceId);
  const { send: socketSend, waitForOpen: socketWaitForOpen } = useDuelSocket({
    userId,
    deviceId,
    enabled: liveEnabled,
    onMessage: handleSocketMessage,
  });

  /** Queues for a live rival; resolves with the match, `no-rival` after the server's queue timeout, or `unavailable`. */
  const findLiveRival = useCallback(async (): Promise<LiveSearchResult> => {
    if (!(await socketWaitForOpen(SOCKET_OPEN_WAIT_MS))) return { kind: 'unavailable' };
    return new Promise<LiveSearchResult>((resolve) => {
      const finish = (result: LiveSearchResult) => {
        clearTimeout(timer);
        searchWaiterRef.current = null;
        resolve(result);
      };
      const timer = setTimeout(() => finish({ kind: 'no-rival' }), LIVE_SEARCH_MAX_MS);
      searchWaiterRef.current = (message) => {
        if (message.type === 'queued') {
          setSearch((s) => ({ ...s, deadline: Date.now() + message.timeoutMs, searchMs: message.timeoutMs }));
        } else if (message.type === 'matched') {
          finish({ kind: 'matched', matchId: message.matchId, rival: message.rival });
        } else if (message.type === 'no-rival') {
          finish({ kind: 'no-rival' });
        } else if (message.type === 'error') {
          finish({ kind: 'unavailable' });
        }
      };
      if (!socketSend({ type: 'queue', categories })) finish({ kind: 'unavailable' });
    });
  }, [categories, socketSend, socketWaitForOpen]);

  // Match initialization / start / resume
  useEffect(() => {
    let cancelled = false;

    async function initMatch() {
      // 1. Resuming by reloadMatchId
      if (reloadMatchId) {
        try {
          const matchState = await api<MatchState>(
            `/api/duel/matches/${reloadMatchId}/state?userId=${encodeURIComponent(userId)}`,
          );
          if (cancelled) return;
          dispatch({ type: 'match.state', state: matchState });
          if (matchState.finished) {
            await fetchResult(reloadMatchId);
          }
        } catch (err) {
          if (cancelled) return;
          const is404 = err instanceof ApiError && err.status === 404;
          dispatch({
            type: 'error',
            code: is404 ? 'MATCH_NOT_FOUND' : 'RESUME_FAILED',
            message: is404 ? 'Match not found or expired.' : 'Failed to resume match.',
          });
        }
        return;
      }

      // 2. Resuming stored match
      const stored = readStoredMatch(categories, mode, userId);
      if (stored) {
        try {
          const matchState = await api<MatchState>(
            `/api/duel/matches/${stored.matchId}/state?userId=${encodeURIComponent(userId)}`,
          );
          if (cancelled) return;
          dispatch({ type: 'match.state', state: matchState });
          if (matchState.finished) {
            await fetchResult(stored.matchId);
          }
          return;
        } catch {
          clearStoredActiveMatch(userId);
        }
      }

      // 3. Starting new match: a live rival first, the simulated one when nobody else is searching
      if (mode === 'HUMAN' && !liveEnabled) {
        await wait(FINDING_RIVAL_MS);
      } else if (mode === 'HUMAN') {
        const live = await findLiveRival();
        if (cancelled) return;
        if (live.kind === 'matched') {
          setSearch({ phase: 'matched', deadline: null, searchMs: null, rival: live.rival });
          try {
            const [matchState] = await Promise.all([
              api<MatchState>(`/api/duel/matches/${live.matchId}/state?userId=${encodeURIComponent(userId)}`),
              wait(MATCHED_INTRO_MS),
            ]);
            if (cancelled) return;
            dispatch({ type: 'match.state', state: matchState });
          } catch (err) {
            if (cancelled) return;
            dispatch({
              type: 'error',
              code: 'START_FAILED',
              message: err instanceof Error ? err.message : 'Failed to start match.',
            });
          }
          return;
        }
        setSearch((s) => ({ ...s, phase: 'fallback' }));
        if (live.kind === 'unavailable') {
          await wait(FINDING_RIVAL_MS);
        }
      }
      if (cancelled) return;

      try {
        const body: StartMatchRequest = { userId, categories, mode };
        const start = await api<MatchStart>('/api/duel/matches', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (cancelled) return;
        dispatch({ type: 'match.start', payload: start });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: 'error',
          code: 'START_FAILED',
          message: err instanceof Error ? err.message : 'Failed to start match.',
        });
      }
    }

    void initMatch();

    return () => {
      cancelled = true;
      if (searchWaiterRef.current) {
        searchWaiterRef.current({ type: 'error', code: 'CANCELLED' });
        socketSend({ type: 'cancel' });
      }
    };
  }, [categories, mode, reloadMatchId, sessionKey, fetchResult, userId, findLiveRival, socketSend, liveEnabled]);

  const submitAnswer = useCallback(
    async (answer: DuelAnswer) => {
      const current = latestRef.current;
      if (current.phase !== 'question' || !current.question || current.matchId === null) {
        return;
      }
      if (answeringRef.current) return;
      answeringRef.current = true;

      const qIndex = current.question.index;
      try {
        const payload: AnswerRequest = { userId, index: qIndex, ...answer };
        const result = await api<AnswerResult>(`/api/duel/matches/${current.matchId}/answers`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (result.correct) {
          playSound('correct');
          haptic('success');
        } else {
          playSound('wrong');
          haptic('error');
        }

        dispatch({
          type: 'answer.result',
          index: result.index,
          correct: result.correct,
          timedOut: result.timedOut,
          nextQuestion: result.nextQuestion,
          rivalProgress: result.rivalProgress,
          yourFinal: result.yourFinal,
          finished: result.finished,
        });

        if (result.finished) {
          void fetchResult(current.matchId);
        }
      } catch (err) {
        dispatch({
          type: 'error',
          code: 'ANSWER_FAILED',
          message: err instanceof Error ? err.message : 'Failed to submit answer.',
        });
      } finally {
        answeringRef.current = false;
      }
    },
    [fetchResult, userId],
  );

  // Auto advance after feedback
  useEffect(() => {
    if (state.phase !== 'feedback') return;
    const timer = setTimeout(() => {
      dispatch({ type: 'ui.advance' });
    }, FEEDBACK_AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  // Countdown timer on active question
  useEffect(() => {
    if (state.phase !== 'question' || !state.question) return;
    const deadline = state.question.deadline;

    function tick() {
      const remainingMs = deadline - Date.now();
      const sec = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsLeft(sec);
      if (remainingMs <= 0) {
        // Timeout
        submitAnswer({ option: -1 });
      }
    }

    tick();
    const interval = setInterval(tick, COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [state.phase, state.question, submitAnswer]);

  // Polling on waiting screen
  useEffect(() => {
    if (state.phase !== 'waiting' || state.matchId === null || state.finished) return;

    let active = true;
    const matchId = state.matchId;

    async function poll() {
      try {
        const ms = await api<MatchState>(`/api/duel/matches/${matchId}/state?userId=${encodeURIComponent(userId)}`);
        if (!active) return;
        dispatch({ type: 'match.state', state: ms });
        if (ms.finished) {
          await fetchResult(matchId);
        }
      } catch {
        // Polling failure, will retry next interval
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [state.phase, state.matchId, state.finished, fetchResult, userId]);

  const nextQuestion = useCallback(() => {
    dispatch({ type: 'ui.advance' });
  }, []);

  const leave = useCallback(() => {
    clearStoredActiveMatch(userId);
  }, [userId]);

  const retry = useCallback(() => {
    setSearch({ phase: 'searching', deadline: null, searchMs: null, rival: null });
    dispatch({ type: 'ui.clearError' });
    setSessionKey((k) => k + 1);
  }, []);

  return {
    state,
    search,
    secondsLeft,
    submitAnswer,
    nextQuestion,
    leave,
    retry,
  };
}
