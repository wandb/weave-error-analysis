"use client";

import { User, Bot, Wrench } from "lucide-react";
import type { ConversationMessage as ConversationMessageType } from "../types";
import { formatTime } from "../utils/formatters";

interface Props {
  message: ConversationMessageType;
  index: number;
}

export function ConversationMessage({ message, index }: Props) {
  if (message.type === "user") {
    return (
      <div key={`${message.call_id}-${index}`} className="flex gap-3 animate-fade-in">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-coral/20 flex items-center justify-center">
          <User className="w-4 h-4 text-accent-coral" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-accent-coral">User</span>
            <span className="text-xs text-ink-500">{formatTime(message.timestamp)}</span>
          </div>
          <div className="bg-ink-900 rounded-lg rounded-tl-none p-3 border border-ink-800">
            <p className="text-sm text-sand-200 whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  if (message.type === "assistant") {
    return (
      <div key={`${message.call_id}-${index}`} className="flex gap-3 animate-fade-in">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-teal/20 flex items-center justify-center">
          <Bot className="w-4 h-4 text-accent-teal" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-accent-teal">Assistant</span>
            <span className="text-xs text-ink-500">{formatTime(message.timestamp)}</span>
          </div>
          <div className="bg-ink-950 rounded-lg rounded-tl-none p-3 border border-ink-800">
            <p className="text-sm text-sand-300 whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  if (message.type === "tool_call") {
    return (
      <div key={`${message.call_id}-${index}`} className="flex gap-3 animate-fade-in">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-gold/20 flex items-center justify-center">
          <Wrench className="w-4 h-4 text-accent-gold" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-accent-gold">
              Tool: {message.tool_name}
            </span>
            <span className="text-xs text-ink-500">{formatTime(message.timestamp)}</span>
          </div>
          <div className="bg-ink-950 rounded-lg rounded-tl-none p-3 border border-accent-gold/30 space-y-2">
            {message.tool_input && (
              <div>
                <span className="text-xs text-ink-500">Input:</span>
                <pre className="text-xs text-sand-400 mt-1 overflow-x-auto">
                  {JSON.stringify(message.tool_input, null, 2)}
                </pre>
              </div>
            )}
            {message.tool_output && (
              <div className="border-t border-ink-800 pt-2 mt-2">
                <span className="text-xs text-ink-500">Output:</span>
                <pre className="text-xs text-accent-teal mt-1 overflow-x-auto max-h-32">
                  {typeof message.tool_output === "string"
                    ? message.tool_output.slice(0, 500) +
                      (message.tool_output.length > 500 ? "..." : "")
                    : JSON.stringify(message.tool_output, null, 2).slice(0, 500)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

