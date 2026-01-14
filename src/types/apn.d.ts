declare module '@parse/node-apn' {
  export interface ProviderOptions {
    token: {
      key: string;
      keyId: string;
      teamId: string;
    };
    production: boolean;
  }

  export interface NotificationAlertObject {
    title?: string;
    body?: string;
  }

  export interface SendResult {
    sent: Array<{ device: string }>;
    failed: Array<{
      device: string;
      error?: Error;
      response?: { reason?: string; status?: number };
      status?: number;
    }>;
  }

  export class Notification {
    topic: string;
    pushType: 'alert' | 'voip';
    priority: number;
    expiry: number;
    alert?: string | NotificationAlertObject;
    sound?: string;
    category?: string;
    interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical';
    contentAvailable?: boolean;
    payload: Record<string, unknown>;
  }

  export class Provider {
    constructor(options: ProviderOptions);
    send(notification: Notification, tokens: string[]): Promise<SendResult>;
    shutdown(): void;
  }
}
