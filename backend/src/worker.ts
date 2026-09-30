import { dispatchPendingOutboxEvents } from "./modules/batches/outbox.dispatcher.js";
import {
  ensureEmailIndex,
  reindexAllEmails,
} from "./infrastructure/elasticsearch/email.index.js";
import "./workers/email.worker.js";

async function startWorker() {
  console.log("Email worker process started");

  try {
    await ensureEmailIndex();
    await reindexAllEmails();
  } catch (error) {
    console.error(
      "Elasticsearch startup sync failed. PostgreSQL and BullMQ will continue:",
      error,
    );
  }

  await dispatchPendingOutboxEvents();

  console.log("Outbox recovery completed");
}

startWorker().catch((error) => {
  console.error("Worker startup failed:", error);
  process.exit(1);
});
