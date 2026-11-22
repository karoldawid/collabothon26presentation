package com.collabothon.back.duel.live;

import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Optional;
import java.util.SequencedMap;

import org.springframework.stereotype.Service;

import com.collabothon.back.config.DuelProperties;
import com.collabothon.back.duel.consts.DuelConsts;
import com.collabothon.back.duel.consts.DuelSocketConsts;
import com.collabothon.back.duel.services.DuelStartService;
import com.collabothon.back.duel.services.LiveMatch;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

// The live-duel queue. It tells players of a match only once startLive has committed its own transaction.
@Slf4j
@Service
@RequiredArgsConstructor
public class DuelMatchmakingService {

	private final DuelStartService startService;

	private final DuelLiveNotifier notifier;

	private final DuelTimers timers;

	private final Clock clock;

	private final DuelProperties properties;

	/** Waiting players by user id, in queue order; guarded by {@code this}. */
	private final SequencedMap<String, WaitingPlayer> queue = new LinkedHashMap<>();

	private long lastTicket;

	/** Pairs with the longest-waiting other account, or waits. Queuing again restarts the wait. */
	public void join(String userId, List<String> categories) {
		if (categories.isEmpty() || categories.size() > DuelConsts.MAX_CATEGORIES) {
			notifier.send(userId, DuelSocketMessages.error(DuelSocketConsts.INVALID_CATEGORIES_ERROR));
			return;
		}
		WaitingPlayer player;
		Optional<WaitingPlayer> rival;
		synchronized (this) {
			player = new WaitingPlayer(userId, List.copyOf(categories), clock.instant(), ++lastTicket);
			rival = takeRivalOrQueue(player);
		}
		rival.ifPresentOrElse(waiting -> pair(waiting, player), () -> awaitRival(player));
	}

	public synchronized void cancel(String userId) {
		queue.remove(userId);
	}

	// Leaving the queue first is what keeps an account from being paired with itself.
	private Optional<WaitingPlayer> takeRivalOrQueue(WaitingPlayer player) {
		queue.remove(player.userId());
		if (queue.isEmpty()) {
			queue.put(player.userId(), player);
			return Optional.empty();
		}
		return Optional.of(queue.pollFirstEntry().getValue());
	}

	private void awaitRival(WaitingPlayer player) {
		timers.schedule(() -> expire(player), queueTimeout());
		notifier.send(player.userId(), DuelSocketMessages.queued(properties.queueTimeoutMs()));
	}

	private void expire(WaitingPlayer player) {
		if (removeIfExpired(player)) {
			notifier.send(player.userId(), DuelSocketMessages.noRival());
		}
	}

	private synchronized boolean removeIfExpired(WaitingPlayer player) {
		if (!player.equals(queue.get(player.userId()))
				|| clock.instant().isBefore(player.queuedAt().plus(queueTimeout()))) {
			return false;
		}
		queue.remove(player.userId());
		return true;
	}

	private void pair(WaitingPlayer first, WaitingPlayer second) {
		List<String> categories = commonCategories(first.categories(), second.categories());
		try {
			LiveMatch live = startService.startLive(first.userId(), second.userId(), categories);
			notifier.send(live.userA(), DuelSocketMessages.matched(live.matchIdA(), live.cardB(), live.categories()));
			notifier.send(live.userB(), DuelSocketMessages.matched(live.matchIdB(), live.cardA(), live.categories()));
		}
		catch (RuntimeException e) {
			log.warn("Could not start a live duel for {} and {}", first.userId(), second.userId(), e);
			notifier.send(first.userId(), DuelSocketMessages.error(DuelSocketConsts.MATCH_FAILED_ERROR));
			notifier.send(second.userId(), DuelSocketMessages.error(DuelSocketConsts.MATCH_FAILED_ERROR));
		}
	}

	/** The categories both ticked, in the first player's order; the first player's own when there are none. */
	private static List<String> commonCategories(List<String> first, List<String> second) {
		List<String> common = first.stream().filter(second::contains).distinct().toList();
		if (common.isEmpty()) {
			return first;
		}
		return common;
	}


	private Duration queueTimeout() {
		return Duration.ofMillis(properties.queueTimeoutMs());
	}

}
