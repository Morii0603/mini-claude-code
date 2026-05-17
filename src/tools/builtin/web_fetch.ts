import { BaseTool } from "../types.js";
import type { InputSchema } from "../types.js";

export class WebFetchTool extends BaseTool {
  name = "web_fetch";
  description =
    "Fetch a URL and return its content as text. For HTML pages, tags are stripped to return readable text. For JSON/text responses, content is returned directly.";
  input_schema: InputSchema = {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch" },
      max_length: {
        type: "number",
        description:
          "Maximum content length in characters (default 50000)",
      },
    },
    required: ["url"],
  };

  async run(input: Record<string, unknown>): Promise<string> {
    const url = input.url as string;
    const maxLength = (input.max_length as number) ?? 50_000;

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "mini-claude-code/1.0" },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return `HTTP error: ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") || "";
      let text = await response.text();

      // Strip HTML tags if it's an HTML response
      if (contentType.includes("text/html")) {
        text = text
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
          .replace(/\s{2,}/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }

      if (text.length > maxLength) {
        text = `${text.slice(0, maxLength)}\n\n[... truncated at ${maxLength} characters]`;
      }

      return text || "(empty response)";
    } catch (err: any) {
      if (err.name === "AbortError" || err.name === "TimeoutError") {
        return `Request timed out after 30s`;
      }
      return `Error fetching ${url}: ${err.message}`;
    }
  }
}
