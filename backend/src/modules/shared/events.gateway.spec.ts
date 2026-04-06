import { EventsGateway } from "./events.gateway";
import { EventBus } from "./event_bus";

describe("EventsGateway", () => {
  function createGateway() {
    const eventBus = new EventBus();
    const lyriaRealtime = {
      stopSession: jest.fn(),
    } as any;

    const gateway = new EventsGateway(eventBus, lyriaRealtime);
    const emit = jest.fn();
    const roomEmit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit: roomEmit });

    gateway.server = {
      emit,
      to,
      sockets: { sockets: new Map() },
    } as any;

    return { gateway, eventBus, emit, to, roomEmit };
  }

  it("broadcasts dispute status updates for filed, resolved, and appealed events", async () => {
    const { gateway, eventBus, emit } = createGateway();

    eventBus.publish({
      eventName: "contract.dispute_filed",
      eventVersion: 1,
      occurredAt: "2026-04-07T10:00:00.000Z",
      disputeId: "123",
      tokenId: "77",
      reporterAddress: "0xreporter",
      creatorAddress: "0xcreator",
      counterStake: "1000",
      evidenceURI: "ipfs://evidence",
      chainId: 31337,
      contractAddress: "0xcontract",
      transactionHash: "0xtx1",
      blockNumber: "1",
    });

    eventBus.publish({
      eventName: "contract.dispute_resolved",
      eventVersion: 1,
      occurredAt: "2026-04-07T10:01:00.000Z",
      disputeId: "123",
      tokenId: "77",
      outcome: "1",
      resolverAddress: "0xresolver",
      chainId: 31337,
      contractAddress: "0xcontract",
      transactionHash: "0xtx2",
      blockNumber: "2",
    });

    eventBus.publish({
      eventName: "contract.dispute_appealed",
      eventVersion: 1,
      occurredAt: "2026-04-07T10:02:00.000Z",
      disputeId: "123",
      appealerAddress: "0xreporter",
      appealNumber: "1",
      chainId: 31337,
      contractAddress: "0xcontract",
      transactionHash: "0xtx3",
      blockNumber: "3",
    });

    expect(emit).toHaveBeenCalledWith(
      "dispute.status",
      expect.objectContaining({
        type: "filed",
        disputeId: "123",
        tokenId: "77",
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      "dispute.status",
      expect.objectContaining({
        type: "resolved",
        disputeId: "123",
        outcome: "1",
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      "dispute.status",
      expect.objectContaining({
        type: "appealed",
        disputeId: "123",
        appealNumber: "1",
      }),
    );

    gateway.onModuleDestroy();
  });

  it("delivers notification.created events to the correct wallet room", () => {
    const { gateway, eventBus, to, roomEmit } = createGateway();

    eventBus.publish({
      eventName: "notification.created",
      eventVersion: 1,
      occurredAt: "2026-04-07T10:03:00.000Z",
      walletAddress: "0xabc",
      notificationId: "notif-1",
      type: "dispute_resolved",
      title: "Resolved",
      message: "Resolved",
      disputeId: "123",
    });

    expect(to).toHaveBeenCalledWith("wallet:0xabc");
    expect(roomEmit).toHaveBeenCalledWith(
      "notification.new",
      expect.objectContaining({
        id: "notif-1",
        type: "dispute_resolved",
        disputeId: "123",
      }),
    );

    gateway.onModuleDestroy();
  });

  it("joins and leaves wallet rooms on socket commands", () => {
    const { gateway } = createGateway();
    const client = {
      id: "client-1",
      on: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
    } as any;

    gateway.handleConnection(client);

    const joinHandler = client.on.mock.calls.find(([name]: [string]) => name === "wallet:join")?.[1];
    const leaveHandler = client.on.mock.calls.find(([name]: [string]) => name === "wallet:leave")?.[1];

    joinHandler("0xAbC");
    leaveHandler("0xAbC");

    expect(client.join).toHaveBeenCalledWith("wallet:0xabc");
    expect(client.leave).toHaveBeenCalledWith("wallet:0xabc");

    gateway.onModuleDestroy();
  });
});
