import React from "react";

export interface ConnectRowProps {
  onConnectChatGpt: () => void;
}

export function ConnectRow({ onConnectChatGpt }: ConnectRowProps) {
  return (
    <div className="connect-row">
      <div>
        <strong>Account sources</strong>
        <span>Demo stays local until you connect.</span>
      </div>
      <button
        className="button button--secondary"
        type="button"
        onClick={onConnectChatGpt}
        aria-label="Connect ChatGPT"
      >
        Connect
      </button>
    </div>
  );
}
