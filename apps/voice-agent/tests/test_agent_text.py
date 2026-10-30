"""Teste do agente de voz em modo texto (sem sala, sem áudio), contra um servidor
falso que imita a função claude-voice. Precisa do livekit-agents instalado:
    pip install -r requirements.txt && python -m unittest discover -s tests
"""

import asyncio
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from aiohttp import web
    import aiohttp
except ImportError:  # pragma: no cover
    web = None

PORT = 18765
os.environ["SUPABASE_URL"] = f"http://127.0.0.1:{PORT}"
os.environ["NEXUS_INTERNAL_SECRET"] = "segredo-teste"

if web is not None:
    try:
        import agent  # noqa: E402
        from livekit.agents import AgentSession, llm  # noqa: E402
        from livekit.agents.llm import StopResponse  # noqa: E402
    except ImportError:  # pragma: no cover
        agent = None
else:  # pragma: no cover
    agent = None


class FakeServer:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.secret_ok = True

    async def handle(self, request: "web.Request") -> "web.StreamResponse":
        body = await request.json()
        self.calls.append(body)
        if request.headers.get("x-nexus-internal") != "segredo-teste":
            self.secret_ok = False
            return web.json_response({"error": "segredo"}, status=401)
        if body.get("action") != "reply":
            return web.json_response({"ok": True})
        resp = web.StreamResponse(headers={"Content-Type": "text/plain; charset=utf-8"})
        await resp.prepare(request)
        for part in ["O ALPHA ", "tem 3 tarefas ", "abertas."]:
            await resp.write(part.encode("utf-8"))
            await asyncio.sleep(0.01)
        await resp.write_eof()
        return resp


def assistant_texts(result) -> list[str]:
    out = []
    for ev in result.events:
        item = getattr(ev, "item", None)
        if item is not None and getattr(item, "role", None) == "assistant":
            out.append(item.text_content or "")
    return out


@unittest.skipIf(agent is None, "livekit-agents não instalado")
class AgentTextTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.fake = FakeServer()
        app = web.Application()
        app.router.add_post("/functions/v1/claude-voice", self.fake.handle)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        await web.TCPSite(self.runner, "127.0.0.1", PORT).start()
        self.brain = agent.Brain({"session_id": "s1", "inviter_id": "u-dono", "mode": "hibrido"})
        self.brain.http = aiohttp.ClientSession()
        self.brain.fallback_speaker = ("u-dono", "José")
        self.brain.listeners = ["u-dono", "u-matheus"]
        self.session = AgentSession(llm=agent.NexusLLM(self.brain))
        self.agent = agent.NexusClaude(self.brain)
        await self.session.start(self.agent)

    async def asyncTearDown(self) -> None:
        await self.session.aclose()
        await self.brain.http.close()
        await self.runner.cleanup()

    async def turn(self, text: str) -> bool:
        """Simula o fim de uma fala (o que o STT dispara na call). True = vai responder."""
        msg = llm.ChatMessage(role="user", content=[text])
        try:
            await self.agent.on_user_turn_completed(llm.ChatContext(), msg)
            return True
        except StopResponse:
            return False

    async def test_responde_quando_chamado(self) -> None:  # Teste A
        self.assertTrue(await self.turn("Claude, qual é o status do ALPHA?"))
        result = await self.session.run(user_input="Claude, qual é o status do ALPHA?")
        self.assertEqual(assistant_texts(result), ["O ALPHA tem 3 tarefas abertas."])
        call = [c for c in self.fake.calls if c.get("action") == "reply"][-1]
        self.assertTrue(self.fake.secret_ok)
        self.assertEqual(call["speaker_id"], "u-dono")
        self.assertTrue(call["addressed"])
        self.assertEqual(call["listeners"], ["u-dono", "u-matheus"])
        self.assertEqual(call["text"], "Claude, qual é o status do ALPHA?")

    async def test_nao_interrompe_conversa(self) -> None:  # Teste B
        self.assertFalse(await self.turn("bora testar a skill de raio hoje?"))
        self.assertIsNone(self.brain.pending)
        # A fala fica no histórico, para dar contexto quando chamarem o Claude
        self.assertEqual(self.brain.history[-1]["text"], "bora testar a skill de raio hoje?")
        self.assertEqual(self.brain.history[-1]["speaker"], "José")

    async def test_modo_participante_ativo_avalia(self) -> None:
        self.brain.mode = "participante_ativo"
        self.assertTrue(await self.turn("alguém sabe por que o mapa trava no celular?"))
        self.assertFalse(self.brain.pending["addressed"])

    async def test_escuta_pausada_e_silenciado(self) -> None:
        self.brain.paused = True
        self.assertFalse(await self.turn("Claude, tá aí?"))
        self.brain.paused = False
        self.brain.muted = True
        self.assertFalse(await self.turn("Claude, tá aí?"))

    async def test_sem_pendencia_nao_fala(self) -> None:
        result = await self.session.run(user_input="qualquer coisa")
        self.assertEqual(assistant_texts(result), [])
        self.assertEqual([c for c in self.fake.calls if c.get("action") == "reply"], [])

    async def test_historico_vai_junto(self) -> None:
        await self.turn("o mapa ficou pronto")
        await self.turn("Claude, resume pra gente")
        await self.session.run(user_input="Claude, resume pra gente")
        call = [c for c in self.fake.calls if c.get("action") == "reply"][-1]
        self.assertEqual(call["history"][-1]["text"], "o mapa ficou pronto")


if __name__ == "__main__":
    unittest.main()
