package com.collabothon.back.duel.consts;

import java.time.Duration;

public final class DuelSocketConsts {

	public static final String PATH = "/ws/duel";

	public static final Duration DISCONNECT_GRACE = Duration.ofSeconds(10);

	public static final int SEND_TIME_LIMIT_MS = 5_000;

	public static final int BUFFER_SIZE_LIMIT = 64 * 1024;

	public static final String USER_ID_ATTRIBUTE = "duel.userId";

	public static final String DEVICE_ID_ATTRIBUTE = "duel.deviceId";

	public static final String QUEUE_MESSAGE = "queue";

	public static final String CANCEL_MESSAGE = "cancel";

	public static final String PING_MESSAGE = "ping";

	public static final String BAD_MESSAGE_ERROR = "BAD_MESSAGE";

	public static final String NOT_LOCKED_ERROR = "NOT_LOCKED";

	public static final String INVALID_CATEGORIES_ERROR = "INVALID_CATEGORIES";

	public static final String MATCH_FAILED_ERROR = "MATCH_FAILED";

	public static final String TIMER_THREAD_NAME = "duel-live-timers";

}
