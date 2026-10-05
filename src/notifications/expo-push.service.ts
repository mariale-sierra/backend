import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PushTokensService } from './push-tokens.service';

export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_RECEIPTS_URL =
  'https://exp.host/--/api/v2/push/getReceipts';

/** Expo accepts at most 100 messages per send and 1000 ids per receipts call. */
const SEND_CHUNK = 100;
const RECEIPTS_CHUNK = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Bounds memory if receipts can't be fetched for a while. */
const MAX_PENDING_RECEIPTS = 10_000;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  /** Navigation ids only — never user content (see notification-catalog.ts). */
  data: Record<string, string>;
  sound?: 'default';
  badge?: number;
  channelId?: string;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Sends pushes through Expo's HTTP push service (expo-notifications on the
 * app side, so Expo handles FCM/APNs credentials configured in EAS).
 *
 * Never throws: every failure is logged and swallowed, because a push is
 * always a side effect of something the user already did successfully.
 *
 * Invalid tokens are handled in both places Expo reports them:
 *  - the send ticket (`DeviceNotRegistered` right away), and
 *  - the delivery receipt, checked by a cron every 10 minutes (a receipt
 *    that isn't ready yet just stays pending for the next run). Pending
 *    ticket ids live in memory: a restart
 *    loses them, which only delays cleanup until the next send to that
 *    token fails at the ticket stage.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly pendingReceipts = new Map<string, string>();

  constructor(private readonly pushTokens: PushTokensService) {}

  async send(messages: ExpoPushMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i += SEND_CHUNK) {
      const chunk = messages.slice(i, i + SEND_CHUNK);
      try {
        const tickets = await this.post<ExpoTicket[]>(
          EXPO_PUSH_SEND_URL,
          chunk,
        );
        if (!tickets) continue;
        await this.handleTickets(chunk, tickets);
      } catch (error) {
        this.logger.warn(`Expo push send failed: ${errorMessage(error)}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkReceipts(): Promise<void> {
    const ids = [...this.pendingReceipts.keys()];
    for (let i = 0; i < ids.length; i += RECEIPTS_CHUNK) {
      const chunk = ids.slice(i, i + RECEIPTS_CHUNK);
      try {
        const receipts = await this.post<Record<string, ExpoReceipt>>(
          EXPO_PUSH_RECEIPTS_URL,
          { ids: chunk },
        );
        if (!receipts) continue;
        const invalid: string[] = [];
        for (const id of chunk) {
          const receipt = receipts[id];
          // Not ready yet: keep it for the next run.
          if (!receipt) continue;
          const token = this.pendingReceipts.get(id);
          this.pendingReceipts.delete(id);
          if (receipt.status !== 'error') continue;
          if (receipt.details?.error === 'DeviceNotRegistered' && token) {
            invalid.push(token);
          } else {
            this.logger.warn(
              `Expo push receipt error: ${receipt.details?.error ?? receipt.message ?? 'unknown'}`,
            );
          }
        }
        await this.pushTokens.deactivate(invalid);
      } catch (error) {
        this.logger.warn(`Expo receipts check failed: ${errorMessage(error)}`);
      }
    }
  }

  private async handleTickets(
    chunk: ExpoPushMessage[],
    tickets: ExpoTicket[],
  ): Promise<void> {
    const invalid: string[] = [];
    tickets.forEach((ticket, index) => {
      const token = chunk[index]?.to;
      if (ticket.status === 'ok') {
        if (ticket.id && this.pendingReceipts.size < MAX_PENDING_RECEIPTS) {
          this.pendingReceipts.set(ticket.id, token);
        }
        return;
      }
      if (ticket.details?.error === 'DeviceNotRegistered' && token) {
        invalid.push(token);
        return;
      }
      this.logger.warn(
        `Expo push ticket error: ${ticket.details?.error ?? ticket.message ?? 'unknown'}`,
      );
    });
    await this.pushTokens.deactivate(invalid);
  }

  /** POSTs to Expo and returns `data`, or undefined (logged) on a non-2xx answer. */
  private async post<T>(url: string, body: unknown): Promise<T | undefined> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    // Optional "enhanced push security" access token from the Expo account.
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      this.logger.warn(`Expo push service answered HTTP ${response.status}`);
      return undefined;
    }
    const json = (await response.json()) as { data?: T };
    return json.data;
  }

  /** Test hook: how many receipts are waiting to be checked. */
  pendingReceiptCount(): number {
    return this.pendingReceipts.size;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
