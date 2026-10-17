import { Suspense } from "react";
import { CreateVideoForm } from "@/components/CreateVideoForm";
import { History, HistorySkeleton } from "@/components/History";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Video generator</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Describe the video you want, style included. It plays here and downloads as a video file.
        </p>
      </header>

      <CreateVideoForm />

      <section aria-labelledby="history-heading" className="mt-12">
        <h2 id="history-heading" className="text-base font-medium text-zinc-200">
          Your videos
        </h2>
        <Suspense fallback={<HistorySkeleton />}>
          <History />
        </Suspense>
      </section>
    </main>
  );
}
