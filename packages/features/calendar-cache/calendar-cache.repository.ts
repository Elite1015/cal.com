import type { Prisma } from "@prisma/client";

import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";
import type { Calendar } from "@calcom/types/Calendar";

import type { ICalendarCacheRepository } from "./calendar-cache.repository.interface";
import { watchCalendarSchema } from "./calendar-cache.repository.schema";

const log = logger.getSubLogger({ prefix: ["CalendarCacheRepository"] });

/** Enable or disable the expanded cache. Enabled by default. */
const ENABLE_EXPANDED_CACHE = process.env.ENABLE_EXPANDED_CACHE !== "0";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ONE_MONTH_IN_MS = 30 * MS_PER_DAY;
const CACHING_TIME = ONE_MONTH_IN_MS;

/** Expand the start date to the start of the month */
function getTimeMin(timeMin: string) {
  const dateMin = new Date(timeMin);
  return new Date(dateMin.getFullYear(), dateMin.getMonth(), 1, 0, 0, 0, 0).toISOString();
}

/** Expand the end date to the end of the month */
function getTimeMax(timeMax: string) {
  const dateMax = new Date(timeMax);
  return new Date(dateMax.getFullYear(), dateMax.getMonth() + 1, 0, 0, 0, 0, 0).toISOString();
}

export function parseKeyForCache(args: FreeBusyArgs): string {
  const { timeMin: _timeMin, timeMax: _timeMax, items } = args;
  const { timeMin, timeMax } = handleMinMax(_timeMin, _timeMax);
  const key = JSON.stringify({ timeMin, timeMax, items });
  return key;
}

/**
 * By expanding the cache to whole months, we can save round trips to the third party APIs.
 * In this case we already have the data in the database, so we can just return it.
 */
function handleMinMax(min: string, max: string) {
  if (!ENABLE_EXPANDED_CACHE) return { timeMin: min, timeMax: max };
  return { timeMin: getTimeMin(min), timeMax: getTimeMax(max) };
}

type FreeBusyArgs = { timeMin: string; timeMax: string; items: { id: string }[] };

export class CalendarCacheRepository implements ICalendarCacheRepository {
  calendar: Calendar | null;
  constructor(calendar: Calendar | null = null) {
    this.calendar = calendar;
  }
  async watchCalendar(args: { calendarId: string; eventTypeId: number | null }) {
    const { calendarId, eventTypeId } = args;
    if (typeof this.calendar?.watchCalendar !== "function") {
      log.info(
        '[handleWatchCalendar] Skipping watching calendar due to calendar not having "watchCalendar" method'
      );
      return;
    }
    const response = await this.calendar?.watchCalendar({ calendarId, eventTypeId });
    const parsedResponse = watchCalendarSchema.safeParse(response);
    if (!parsedResponse.success) {
      log.info(
        "[handleWatchCalendar] Received invalid response from calendar.watchCalendar, skipping watching calendar"
      );
      return;
    }

    return parsedResponse.data;
  }

  async unwatchCalendar(args: { calendarId: string; eventTypeId: number | null }) {
    const { calendarId, eventTypeId } = args;
    if (typeof this.calendar?.unwatchCalendar !== "function") {
      log.info(
        '[unwatchCalendar] Skipping unwatching calendar due to calendar not having "unwatchCalendar" method'
      );
      return;
    }
    const response = await this.calendar?.unwatchCalendar({ calendarId, eventTypeId });
    return response;
  }

  async watchCalendars(args: { calendarId: string; eventTypeIds: (number | null)[] }) {
    const { calendarId, eventTypeIds } = args;
    if (typeof this.calendar?.watchCalendars !== "function") {
      log.info(
        '[handleWatchCalendars] Skipping watching calendars due to calendar not having "watchCalendars" method'
      );
      return;
    }
    const response = await this.calendar?.watchCalendars({ calendarId, eventTypeIds });
    const parsedResponse = watchCalendarSchema.safeParse(response);
    if (!parsedResponse.success) {
      log.info(
        "[handleWatchCalendars] Received invalid response from calendar.watchCalendars, skipping watching calendars"
      );
      return;
    }

    return parsedResponse.data;
  }

  async unwatchCalendars(args: { calendarId: string; eventTypeIds: (number | null)[] }) {
    const { calendarId, eventTypeIds } = args;
    if (typeof this.calendar?.unwatchCalendars !== "function") {
      log.info(
        '[unwatchCalendars] Skipping unwatching calendars due to calendar not having "unwatchCalendars" method'
      );
      return;
    }
    const response = await this.calendar?.unwatchCalendars({ calendarId, eventTypeIds });
    return response;
  }

  async getCachedAvailability(credentialId: number, args: FreeBusyArgs) {
    const key = parseKeyForCache(args);
    const cached = await prisma.calendarCache.findUnique({
      where: {
        credentialId_key: {
          credentialId,
          key,
        },
        expiresAt: { gte: new Date(Date.now()) },
      },
    });
    log.info("Got cached availability", safeStringify({ key, cached }));
    return cached;
  }
  async upsertCachedAvailability(
    credentialId: number,
    args: FreeBusyArgs,
    value: Prisma.JsonNullValueInput | Prisma.InputJsonValue
  ) {
    const key = parseKeyForCache(args);
    await prisma.calendarCache.upsert({
      where: {
        credentialId_key: {
          credentialId,
          key,
        },
      },
      update: {
        value,
        expiresAt: new Date(Date.now() + CACHING_TIME),
      },
      create: {
        value,
        credentialId,
        key,
        expiresAt: new Date(Date.now() + CACHING_TIME),
      },
    });
  }
}
