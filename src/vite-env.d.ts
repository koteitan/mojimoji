/// <reference types="vite/client" />

declare const __BUILD_TIMESTAMP_UTC__: string;

// Twitter Widget API types
interface TwitterWidgetAPI {
  widgets?: {
    load: (element?: HTMLElement) => void;
    createTweet: (tweetId: string, element: HTMLElement, options?: object) => Promise<HTMLElement>;
  };
}

interface Window {
  twttr?: TwitterWidgetAPI;
}
