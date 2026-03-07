import { Hono } from "hono";
import { cors } from "hono/cors";
import { listSessions, capture, sendKeys } from "./ssh";

const app = new Hono();
app.use("/api/*", cors());

// API routes
app.get("/api/sessions", async (c) => {
  return c.json(await listSessions());
});

app.get("/api/capture", async (c) => {
  const target = c.req.query("target");
  if (!target) return c.json({ error: "target required" }, 400);
  return c.json({ content: await capture(target) });
});

app.post("/api/send", async (c) => {
  const { target, text } = await c.req.json();
  if (!target || !text) return c.json({ error: "target and text required" }, 400);
  await sendKeys(target, text);
  return c.json({ ok: true, target, text });
});

// Serve UI
const html = Bun.file(import.meta.dir + "/ui.html");
app.get("/", (c) => c.body(html.stream(), { headers: { "Content-Type": "text/html" } }));

// Error handler
app.onError((err, c) => {
  return c.json({ error: err.message }, 500);
});

export { app };

// Auto-start when run directly
if (import.meta.main) {
  const port = +(process.env.MAW_PORT || 3456);
  Bun.serve({ port, fetch: app.fetch });
  console.log(`maw serve → http://localhost:${port}`);
}
