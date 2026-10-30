import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from policy import can_command, is_addressed, pick_speaker, should_consider, tts_config  # noqa: E402


class PolicyTest(unittest.TestCase):
    def test_wake_word(self):
        self.assertTrue(is_addressed("Claude, qual é o status do ALPHA?"))
        self.assertTrue(is_addressed("Nexus IA, qual é o status do ALPHA?"))
        self.assertTrue(is_addressed("néxus i.a. me ajuda"))
        self.assertFalse(is_addressed("abre o NEXUS no celular"))
        self.assertTrue(is_addressed("Nexus, qual é o status do ALPHA?"))
        self.assertTrue(is_addressed("Ei, Nexus, me ajuda"))
        self.assertFalse(is_addressed("Nexusfan entrou no servidor"))
        self.assertTrue(is_addressed("ô Cláude me ajuda"))
        self.assertTrue(is_addressed("e aí clóde"))
        self.assertFalse(is_addressed("o Cláudio vai fazer o mapa"))
        self.assertFalse(is_addressed("salvei na cloud"))
        self.assertFalse(is_addressed(""))

    def test_modes(self):
        # Teste B: conversa sem chamar o Claude → ele não interrompe
        for mode in ("quando_chamado", "hibrido", "segundo_plano"):
            self.assertEqual(should_consider(mode, False), "ignorar")
        self.assertEqual(should_consider("participante_ativo", False), "avaliar")
        for mode in ("quando_chamado", "hibrido", "segundo_plano", "participante_ativo"):
            self.assertEqual(should_consider(mode, True), "responder")

    def test_voices(self):
        self.assertEqual(tts_config("voz1", "normal")["model"], "cartesia/sonic-3")
        self.assertEqual(tts_config("voz1", "rapida")["extra_kwargs"]["speed"], "fast")
        self.assertEqual(tts_config("voz2", "lenta")["model"], "inworld/inworld-tts-2-flash")
        self.assertAlmostEqual(tts_config("voz2", "lenta")["extra_kwargs"]["speaking_rate"], 0.85)
        self.assertEqual(tts_config(None, None)["extra_kwargs"]["speed"], "normal")

    def test_speaker_switch(self):
        self.assertEqual(pick_speaker(["ana", "bia"], "bia", "agent-1", False), "ana")
        self.assertIsNone(pick_speaker(["ana"], "ana", "agent-1", False))
        self.assertIsNone(pick_speaker(["ana"], "bia", "agent-1", True))  # não corta quem está falando
        self.assertIsNone(pick_speaker(["agent-1"], "bia", "agent-1", False))
        self.assertEqual(pick_speaker(["agent-1", "carlos"], None, "agent-1", False), "carlos")

    def test_commands(self):
        self.assertTrue(can_command("pausar_escuta", "qualquer", "dono"))
        self.assertTrue(can_command("silenciar", "qualquer", "dono"))
        self.assertFalse(can_command("retomar_escuta", "qualquer", "dono"))  # Teste J
        self.assertTrue(can_command("retomar_escuta", "dono", "dono"))
        self.assertFalse(can_command("apagar_tudo", "dono", "dono"))
        self.assertFalse(can_command("silenciar", None, "dono"))


if __name__ == "__main__":
    unittest.main()
