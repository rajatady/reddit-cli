export interface RedditPostRef {
  subreddit: string;
  postId: string;
}

export function parseRedditPostUrl(input: string): RedditPostRef {
  const url = new URL(input);
  const match = url.pathname.match(/^\/r\/([^/]+)\/comments\/([^/]+)/);
  if (!match) {
    throw new Error(`Invalid Reddit post URL: ${input}`);
  }
  return {
    subreddit: match[1]!,
    postId: match[2]!,
  };
}

export function parseSubreddit(input: string): string {
  if (!input.includes("://")) {
    return input.replace(/^r\//, "");
  }
  const url = new URL(input);
  const match = url.pathname.match(/^\/r\/([^/]+)/);
  if (!match) {
    throw new Error(`Invalid subreddit input: ${input}`);
  }
  return match[1]!;
}
