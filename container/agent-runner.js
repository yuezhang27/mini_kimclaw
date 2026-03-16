const Anthropic = require("@anthropic-ai/sdk");

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const groupId = process.env.GROUP_ID;
  const messageText = process.env.MESSAGE_TEXT || "";

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  if (!groupId) {
    throw new Error("GROUP_ID is required");
  }

  console.log(`[Agent] Starting with group_id=${groupId}`);
  console.log("[Agent] Calling Claude API...");

  const anthropic = new Anthropic({ apiKey });
  const hardcodedPrompt =
    "Say hi and introduce yourself briefly in the same language as the user's message";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: hardcodedPrompt,
    messages: [
      {
        role: "user",
        content: messageText,
      },
    ],
  });

  const reply = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!reply) {
    throw new Error("Claude returned empty reply");
  }

  console.log(`AGENT_REPLY:${reply}`);
  console.log("[Agent] Done.");
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(`[Agent] Failed: ${error.message}`);
  } else {
    console.error("[Agent] Failed with unknown error");
  }
  process.exit(1);
});
