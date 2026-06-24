import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') ?? '*',
    credentials: true,
  },
  namespace: '/dashboard',
})
export class OrdersGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server: Server;

  private readonly logger = new Logger(OrdersGateway.name);

  afterInit() {
    this.logger.log('WebSocket Gateway iniciado → ws://localhost:3000/dashboard');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  @SubscribeMessage('join_branch')
  handleJoinBranch(
    @MessageBody() data: { branchId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `branch:${data.branchId}`;
    client.join(room);
    client.emit('joined', { room });
    this.logger.log(`Socket ${client.id} → room ${room}`);
  }

  emitNewOrder(order: Record<string, unknown>) {
    if (order.branchId) {
      this.server.to(`branch:${order.branchId}`).emit('new_order', order);
    }
    this.server.to('all').emit('new_order', order);
    this.logger.log(`Nuevo pedido emitido → #${order.orderNumber}`);
  }

  emitOrderStatusUpdate(payload: {
    orderId: string;
    orderNumber: number;
    newStatus: string;
    updatedAt: string;
  }) {
    this.server.emit('order_status_updated', payload);
    this.logger.log(`Estado #${payload.orderNumber} → ${payload.newStatus}`);
  }
}