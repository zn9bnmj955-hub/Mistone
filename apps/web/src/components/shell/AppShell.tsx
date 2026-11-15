import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { LogoMark, Wordmark } from "@orgasport/ui";
import { getMessages } from "@/i18n";
import { getViewer } from "@/lib/viewer";
import { AssistantBubble } from "@/components/assistant/AssistantBubble";
import { SideNav, SideNavView, TabBar, TabBarView, type NavLabels } from "./NavLinks";

async function ViewerNav({ labels, kind }: { labels: NavLabels; kind: "tabs" | "side" }) {
  const viewer = await getViewer();
  const clubMode = Boolean(viewer?.activeClub);
  return kind === "tabs" ? <TabBar labels={labels} clubMode={clubMode} /> : <SideNav labels={labels} clubMode={clubMode} />;
}

/**
 * Main app frame: left sidebar on desktop, bottom tab bar on mobile. Every
 * destination is one tap away; nothing hides behind a hamburger menu.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const m = getMessages();
  const labels: NavLabels = { ...m.nav };
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-surface px-4 py-6 lg:flex">
        <Link href="/accueil" className="flex items-center gap-2 px-2 text-ink">
          <LogoMark size={30} />
          <Wordmark className="text-2xl" />
        </Link>
        <Suspense fallback={<SideNavView labels={labels} clubMode={false} pathname={null} />}>
          <ViewerNav labels={labels} kind="side" />
        </Suspense>
      </aside>
      <div className="min-w-0 pb-28 lg:pb-12">
        <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
          <Link href="/accueil" className="flex items-center gap-2 text-ink">
            <LogoMark size={26} />
            <Wordmark className="text-xl" />
          </Link>
        </header>
        {/* page-enter : entrée douce du contenu à chaque page (globals.css). */}
        <main id="contenu" className="page-enter mx-auto w-full max-w-3xl px-4 pt-5 lg:pt-10">
          {children}
        </main>
      </div>
      <Suspense fallback={<TabBarView labels={labels} clubMode={false} pathname={null} />}>
        <ViewerNav labels={labels} kind="tabs" />
      </Suspense>
      {/* Reads the address (hidden on /assistant): request data, so inside Suspense. */}
      <Suspense fallback={null}>
        <AssistantBubble label={m.assistantUi.open} />
      </Suspense>
    </div>
  );
}
