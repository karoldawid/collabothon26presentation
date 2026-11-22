package com.collabothon.back.duel.live;

import com.collabothon.back.config.DuelProperties;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.collabothon.back.MutableClock;
import com.collabothon.back.dto.duel.PlayerCardDto;
import com.collabothon.back.duel.services.DuelStartService;
import com.collabothon.back.duel.services.LiveMatch;

class DuelMatchmakingServiceTest {

	private static final PlayerCardDto CARD_A = new PlayerCardDto("Daniel Okafor", "m2", Map.of());

	private static final PlayerCardDto CARD_B = new PlayerCardDto("Elena Petrova", "f3", Map.of());

	static final DuelProperties PROPERTIES = new DuelProperties(6, 10_000L, 60_000L, 4.0, 12_000L, 20_000L, 25_000L,
			20_000L, 25_000L, 1000L, 4000L, 15_000L);

	DuelStartService matches = mock(DuelStartService.class);

	DuelLiveNotifier notifier = mock(DuelLiveNotifier.class);

	ManualDuelTimers timers = new ManualDuelTimers();

	MutableClock clock = new MutableClock(Instant.parse("2026-11-23T10:00:00Z"));

	DuelMatchmakingService matchmaking;

	@BeforeEach
	void setUp() {
		matchmaking = new DuelMatchmakingService(matches, notifier, timers, clock, PROPERTIES);
		when(matches.startLive(anyString(), anyString(), anyList())).thenAnswer(call -> new LiveMatch(1, 2,
				call.getArgument(0), call.getArgument(1), CARD_A, CARD_B, call.getArgument(2)));
	}

	@Test
	void pairsTwoDifferentAccountsAndGivesEachTheirOwnMatchId() {
		matchmaking.join("demo-daniel", List.of("berlin"));
		matchmaking.join("demo-elena", List.of("berlin"));

		verify(matches).startLive("demo-daniel", "demo-elena", List.of("berlin"));
		verify(notifier).send("demo-daniel", Map.of("type", "queued", "timeoutMs", 15_000L));
		Map<String, Object> toFirst = sent("demo-daniel", "matched");
		Map<String, Object> toSecond = sent("demo-elena", "matched");
		assertThat(toFirst).containsEntry("matchId", 1L).containsEntry("rival", CARD_B);
		assertThat(toSecond).containsEntry("matchId", 2L).containsEntry("rival", CARD_A);
	}

	@Test
	void aLoneAccountGetsNoRivalAfterFifteenSeconds() {
		matchmaking.join("demo-daniel", List.of("berlin"));

		clock.advance(Duration.ofSeconds(14));
		timers.runAll();
		verify(notifier, never()).send(eq("demo-daniel"), eqType("no-rival"));

		matchmaking.join("demo-daniel", List.of("berlin")); // re-queue restarts the wait
		clock.advance(Duration.ofSeconds(15));
		timers.runAll();
		verify(notifier, times(1)).send(eq("demo-daniel"), eqType("no-rival"));
		verify(matches, never()).startLive(anyString(), anyString(), anyList());
	}

	@Test
	void neverPairsAnAccountWithItself() {
		matchmaking.join("demo-daniel", List.of("berlin"));
		matchmaking.join("demo-daniel", List.of("berlin"));

		verify(matches, never()).startLive(anyString(), anyString(), anyList());
		clock.advance(Duration.ofSeconds(15));
		timers.runAll();
		verify(notifier, times(1)).send(eq("demo-daniel"), eqType("no-rival"));
	}

	@Test
	void cancelLeavesTheQueue() {
		matchmaking.join("demo-daniel", List.of("berlin"));
		matchmaking.cancel("demo-daniel");
		matchmaking.join("demo-elena", List.of("berlin"));

		verify(matches, never()).startLive(anyString(), anyString(), anyList());
		clock.advance(Duration.ofSeconds(15));
		timers.runAll();
		verify(notifier, never()).send(eq("demo-daniel"), eqType("no-rival"));
		verify(notifier, times(1)).send(eq("demo-elena"), eqType("no-rival"));
	}

	@Test
	void usesTheCategoriesBothTickedInTheFirstPlayersOrder() {
		matchmaking.join("demo-daniel", List.of("berlin", "tokyo", "seoul"));
		matchmaking.join("demo-elena", List.of("seoul", "tokyo"));

		verify(matches).startLive("demo-daniel", "demo-elena", List.of("tokyo", "seoul"));
	}

	@Test
	void fallsBackToTheFirstPlayersCategoriesWhenNoneAreShared() {
		matchmaking.join("demo-daniel", List.of("berlin", "tokyo"));
		matchmaking.join("demo-elena", List.of("seoul"));

		verify(matches).startLive("demo-daniel", "demo-elena", List.of("berlin", "tokyo"));
	}

	@Test
	void rejectsAnEmptyCategoryList() {
		matchmaking.join("demo-daniel", List.of());

		verify(notifier).send("demo-daniel", Map.of("type", "error", "code", "INVALID_CATEGORIES"));
	}

	@Test
	void tellsBothPlayersWhenTheMatchCannotStart() {
		when(matches.startLive(anyString(), anyString(), anyList())).thenThrow(new IllegalStateException("boom"));

		matchmaking.join("demo-daniel", List.of("berlin"));
		matchmaking.join("demo-elena", List.of("berlin"));

		Map<String, Object> error = Map.of("type", "error", "code", "MATCH_FAILED");
		verify(notifier).send("demo-daniel", error);
		verify(notifier).send("demo-elena", error);
	}

	@SuppressWarnings("unchecked")
	private Map<String, Object> sent(String userId, String type) {
		ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
		verify(notifier, atLeastOnce()).send(eq(userId), captor.capture());
		return captor.getAllValues().stream().filter(message -> type.equals(message.get("type"))).findFirst().orElseThrow();
	}

	private static Map<String, Object> eqType(String type) {
		return argThat(message -> message != null && type.equals(message.get("type")));
	}

}
