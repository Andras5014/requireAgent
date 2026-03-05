import { useAuthStore } from '../stores/auth';
import type { WSMessage, WSMessageType } from '@requireagent/shared';

type MessageHandler = (message: WSMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: Map<WSMessageType, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private projectId: string | null = null;
  
  connect(projectId: string) {
    if (this.ws?.readyState === WebSocket.OPEN && this.projectId === projectId) {
      return;
    }
    
    this.projectId = projectId;
    const token = useAuthStore.getState().token;
    
    if (!token) {
      console.error('无法连接 WebSocket: 未登录');
      return;
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?token=${token}`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('WebSocket 已连接');
      this.reconnectAttempts = 0;
      
      // 加入房间
      this.send('join_room', { projectId, userId: useAuthStore.getState().user?.id });
    };
    
    this.ws.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        this.notifyHandlers(message);
      } catch (error) {
        console.error('WebSocket 消息解析错误:', error);
      }
    };
    
    this.ws.onclose = (event) => {
      console.log('WebSocket 已断开:', event.code, event.reason);
      
      if (this.reconnectAttempts < this.maxReconnectAttempts && this.projectId) {
        setTimeout(() => {
          this.reconnectAttempts++;
          console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          this.connect(this.projectId!);
        }, this.reconnectDelay * Math.pow(2, this.reconnectAttempts));
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket 错误:', error);
    };
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.projectId = null;
    }
  }
  
  send<T>(type: WSMessageType, payload: T) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type,
        payload,
        timestamp: Date.now(),
      }));
    }
  }
  
  sendMessage(content: string, replyTo?: string, tags?: string[]) {
    if (!this.projectId) return;
    
    this.send('send_message', {
      projectId: this.projectId,
      content,
      replyTo,
      tags,
    });
  }
  
  startTyping() {
    if (!this.projectId) return;
    const user = useAuthStore.getState().user;
    this.send('typing', {
      projectId: this.projectId,
      userId: user?.id,
      nickname: user?.nickname,
    });
  }
  
  stopTyping() {
    if (!this.projectId) return;
    const user = useAuthStore.getState().user;
    this.send('stop_typing', {
      projectId: this.projectId,
      userId: user?.id,
    });
  }
  
  on(type: WSMessageType, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }
  
  private notifyHandlers(message: WSMessage) {
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => handler(message));
    }
  }
}

export const wsService = new WebSocketService();
