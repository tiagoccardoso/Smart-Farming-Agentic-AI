"""Gera os arquivos de teste do E2E em ./assets (fotos e áudio).
Requer Python com Pillow e ffmpeg no PATH."""
import os, random, subprocess
from PIL import Image, ImageDraw

os.makedirs("assets", exist_ok=True)
random.seed(1)

def leaf(name, color, spots):
    im = Image.new("RGB", (1600, 1200), (70, 120, 60))
    d = ImageDraw.Draw(im)
    d.ellipse((200, 150, 1400, 1050), fill=color)
    for _ in range(spots):
        x, y = random.randint(350, 1250), random.randint(250, 950)
        r = random.randint(15, 45)
        d.ellipse((x - r, y - r, x + r, y + r), fill=(110, 70, 30), outline=(60, 40, 10), width=6)
    im.save(os.path.join("assets", name), quality=92)

leaf("folha1.jpg", (90, 160, 70), 25)
leaf("folha2.jpg", (120, 170, 60), 10)
# Foto "de celular" com ~6 MB para validar a compactação no navegador.
Image.effect_noise((3200, 2400), 60).convert("RGB").save(os.path.join("assets", "foto-grande.jpg"), quality=93)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "libopus", "-b:a", "32k", os.path.join("assets", "audio.webm")], check=True)
print("assets gerados")
