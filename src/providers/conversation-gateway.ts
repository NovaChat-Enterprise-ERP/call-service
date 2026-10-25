import type { ConversationAccessDto } from '@novachat-enterprise-erp/contracts';
import type { InternalHttpClient } from '@novachat-enterprise-erp/common';

export interface ConversationGateway {
  isMember(workspaceId: string, conversationId: string, userId: string): Promise<boolean>;
  postSystemMessage(conversationId: string, authorId: string, text: string, body: Record<string, unknown>): Promise<void>;
}

export class MessageServiceConversationGateway implements ConversationGateway {
  constructor(private readonly client: InternalHttpClient) {}

  async isMember(workspaceId: string, conversationId: string, userId: string): Promise<boolean> {
    const access = await this.client.request<ConversationAccessDto>(
      `/internal/conversations/${conversationId}/access/${encodeURIComponent(userId)}`,
    );
    return !!access && access.workspaceId === workspaceId && access.isMember;
  }

  async postSystemMessage(conversationId: string, authorId: string, text: string, body: Record<string, unknown>) {
    await this.client.request(`/internal/conversations/${conversationId}/system-messages`, {
      method: 'POST',
      body: { authorId, text, body },
    });
  }
}
