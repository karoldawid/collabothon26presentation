package com.collabothon.back.duel.services;

import com.collabothon.back.config.DuelProperties;

import lombok.AccessLevel;
import lombok.NoArgsConstructor;

/** Default duel tunables, as bound from an empty {@code app.duel} block. */
@NoArgsConstructor(access = AccessLevel.PRIVATE)
final class DuelTestFixtures {

	static final DuelProperties PROPERTIES = new DuelProperties(6, 10_000L, 60_000L, 4.0, 12_000L, 20_000L,
			25_000L, 20_000L, 25_000L, 1000L, 4000L, 15_000L);

}
