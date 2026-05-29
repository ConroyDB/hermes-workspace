import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'

// DISABLED BY POLICY (Sovereign OS, 2026-05-28):
// This endpoint used to run the online installer
//   `curl -fsSL .../hermes-agent/main/scripts/install.sh | bash`
// via startClaudeAgent(). That installer pulls latest `main`, rebuilds the
// venv WITHOUT the messaging extras, and corrupted the swarm on 2026-05-28.
// The gateways here run under launchd and auto-start on boot — the workspace
// must never (re)install or auto-update the backend. Both the silent
// auto-start timer and the manual button hit this route, so neutralizing it
// here is the single chokepoint. Updates are deliberate/manual only.
export const Route = createFileRoute('/api/start-claude')({
  server: {
    handlers: {
      POST: async () => {
        return json(
          {
            ok: false,
            disabled: true,
            error:
              'Auto-start/auto-install is disabled. Gateways run under launchd; start them with `launchctl kickstart -k gui/$(id -u)/ai.hermes.gateway`.',
          },
          { status: 200 },
        )
      },
    },
  },
})
