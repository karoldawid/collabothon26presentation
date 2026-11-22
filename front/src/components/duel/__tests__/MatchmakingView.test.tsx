import { cleanup, fireEvent, render } from '@testing-library/react-native';

import { MatchmakingView } from '@/components/duel/MatchmakingView';
import { createInitialDuelState } from '@/lib/duel/reducer';
import type { MatchSearch } from '@/lib/duel/useDuelMatch';

afterEach(() => {
  cleanup();
});

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('../../../../jest/reanimated.js');
  return { ...actual, useReducedMotion: () => true };
});

const state = createInitialDuelState(['berlin'], 'HUMAN');
const rival = { name: 'Elena Petrova', avatar: 'f3' as const, levels: { berlin: 2 } };

describe('MatchmakingView', () => {
  it('searching: shows the 15 s countdown ring and Cancel', async () => {
    const onCancel = jest.fn();
    const search: MatchSearch = { phase: 'searching', deadline: Date.now() + 15_000, searchMs: 15_000, rival: null };
    const r = await render(<MatchmakingView state={state} youAvatar="m1" onCancel={onCancel} search={search} />);

    expect(r.getByTestId('matchmaking-title').props.children).toContain('Searching for rival');
    expect(r.getByTestId('matchmaking-ring')).toBeTruthy();
    expect(Number(r.getByTestId('matchmaking-seconds').props.children)).toBeGreaterThanOrEqual(14);

    await fireEvent.press(r.getByTestId('matchmaking-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('searching: the ring counts down the search time the server sent', async () => {
    const search: MatchSearch = { phase: 'searching', deadline: Date.now() + 5_000, searchMs: 5_000, rival: null };
    const r = await render(<MatchmakingView state={state} youAvatar="m1" onCancel={jest.fn()} search={search} />);

    expect(Number(r.getByTestId('matchmaking-seconds').props.children)).toBe(5);
    expect(r.getByTestId('matchmaking-ring').props.accessibilityLabel).toBe('5 seconds left');
  });

  it('searching before the server confirms the queue: spinner instead of a ring', async () => {
    const search: MatchSearch = { phase: 'searching', deadline: null, searchMs: null, rival: null };
    const r = await render(<MatchmakingView state={state} youAvatar="m1" onCancel={jest.fn()} search={search} />);

    expect(r.queryByTestId('matchmaking-ring')).toBeNull();
    expect(r.getByTestId('matchmaking-cancel')).toBeTruthy();
  });

  it('matched: "Rival found!" with the rival name and the LIVE badge', async () => {
    const search: MatchSearch = { phase: 'matched', deadline: null, searchMs: null, rival };
    const r = await render(<MatchmakingView state={state} youAvatar="m1" onCancel={jest.fn()} search={search} />);

    expect(r.getByTestId('matchmaking-matched')).toBeTruthy();
    expect(r.getByTestId('matchmaking-title').props.children).toBe('Rival found!');
    expect(r.getByTestId('matchmaking-rival-name').props.children).toBe('Elena P.');
    expect(r.getByTestId('matchmaking-live-badge')).toBeTruthy();
    expect(r.queryByTestId('matchmaking-cancel')).toBeNull();
  });

  it('no-rival (simulated start): keeps the plain searching look with no error', async () => {
    const search: MatchSearch = { phase: 'fallback', deadline: null, searchMs: null, rival: null };
    const r = await render(<MatchmakingView state={state} youAvatar="m1" onCancel={jest.fn()} search={search} />);

    expect(r.getByTestId('matchmaking-title').props.children).toContain('Searching for rival');
    expect(r.queryByTestId('matchmaking-ring')).toBeNull();
    expect(r.queryByText(/error|failed|wrong/i)).toBeNull();
  });

  it('without a search prop it renders the original searching state', async () => {
    const r = await render(<MatchmakingView state={state} youAvatar="m1" onCancel={jest.fn()} />);
    expect(r.getByTestId('duel-matchmaking')).toBeTruthy();
  });
});
