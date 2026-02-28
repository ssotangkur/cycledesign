import { WebSocket } from "ws";
import { statusBroadcaster } from "./status-broadcaster.js";
import { runAgent } from "../llm/agent.js";

interface WebSocketMessage {
  type: string;
  id?: string;
  content?: string;
  timestamp?: number;
}

export function handleWebSocketConnection(ws: WebSocket) {
  statusBroadcaster.addClient(ws);

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString()) as WebSocketMessage;

      if (message.type === "message" && message.id && message.content) {
        await handleGenerationRequest(ws, message);
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Failed to process message",
        })
      );
    }
  });

  ws.on("close", () => {
    statusBroadcaster.removeClient(ws);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    statusBroadcaster.removeClient(ws);
  });
}

async function handleGenerationRequest(
  ws: WebSocket,
  message: WebSocketMessage
) {
  const messageId = message.id!;
  const userPrompt = message.content!;

  ws.send(
    JSON.stringify({
      type: "ack",
      messageId,
      timestamp: Date.now(),
    })
  );

  try {
    // Use ToolLoopAgent - handles the entire loop automatically
    const result = await runAgent(messageId, userPrompt);

    // Send the final response
    ws.send(
      JSON.stringify({
        type: "content",
        messageId,
        content: result.text || "No code was generated. Please try again.",
        timestamp: Date.now(),
      })
    );

    ws.send(
      JSON.stringify({
        type: "done",
        messageId,
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    console.error("Generation error:", error);
    ws.send(
      JSON.stringify({
        type: "error",
        messageId,
        message: error instanceof Error ? error.message : "Generation failed",
        timestamp: Date.now(),
      })
    );
  }
}
