package com.collabothon.back.config;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

@ConfigurationProperties("app.duel")
@Validated
public record DuelProperties(
		@Min(1)
		@DefaultValue("6")
		int questionsPerMatch,
		@Positive
		@DefaultValue("10000")
		long minTimeLimitMs,
		@Positive
		@DefaultValue("60000")
		long maxTimeLimitMs,
		@Positive
		@DefaultValue("4.0")
		double readingWordsPerSecond,
		@Positive
		@DefaultValue("12000")
		long quizBaseMs,
		@Positive
		@DefaultValue("20000")
		long predictBaseMs,
		@Positive
		@DefaultValue("25000")
		long chartBaseMs,
		@Positive
		@DefaultValue("20000")
		long sortBaseMs,
		@Positive
		@DefaultValue("25000")
		long matchBaseMs,
		@PositiveOrZero
		@DefaultValue("1000")
		long botMinDelayMs,
		@PositiveOrZero
		@DefaultValue("4000")
		long botMaxDelayMs,
		/** How long a player waits in the live queue before the simulated rival takes over. */
		@Positive
		@DefaultValue("15000")
		long queueTimeoutMs) {

	@AssertTrue(message = "app.duel.bot-max-delay-ms must not be below app.duel.bot-min-delay-ms")
	public boolean isBotDelayRangeValid() {
		return botMaxDelayMs >= botMinDelayMs;
	}

}
