"""
surfer.py
─────────
Orchestre la session de surf PR.social via l'extension PR.surf.

Flow (aucune connexion automatique — l'utilisateur lie son compte manuellement)
────────────────────────────────────────────────────────────────────────────────
1. Découvrir l'ID de l'extension (service worker MV3).
2. Ouvrir le popup de l'extension.
3. Cliquer le bouton « pair » → l'extension appelle POST /pair
   et reçoit : { code, link, until, pt }.
4. Afficher le code + le lien dans le terminal.
   → L'utilisateur ouvre pr.social et lie son compte avec ce code.
5. Attendre que l'extension confirme la liaison (poll interne GET /pair/<pt>).
6. Cliquer « Start » dans le popup → surf autonome.
7. Keep-alive : le processus Python reste en vie pendant le surf.
"""

from __future__ import annotations

import re
import time

from tenacity import retry, stop_after_attempt, wait_fixed

from patchright.sync_api import BrowserContext, Page, TimeoutError as PWTimeoutError

from pr_surf.config import settings
from pr_surf.logger import log


# ── API publique ──────────────────────────────────────────────────────────────

def run_surf(context: BrowserContext) -> None:
    """
    Flux complet :

    1. Découvrir l'ID de l'extension → ouvrir son popup.
    2. Vérifier si le compte est déjà lié.
    3. Sinon : déclencher le pairing → afficher le code dans le terminal.
    4. Attendre que l'utilisateur lie son compte sur pr.social.
    5. Cliquer Start → surf autonome.
    6. Keep-alive.
    """
    ext_id = _get_extension_id(context)
    log.info(f"ID extension : {ext_id}")

    popup_url = f"chrome-extension://{ext_id}/popup.html"
    popup = _open_popup(context, popup_url)

    if _popup_is_connected(popup):
        log.info("Compte déjà lié détecté dans le popup — on ne relance pas le jumelage.")
    else:
        pair_info = _trigger_pairing(popup)

        # ── Affichage clair du code pour l'utilisateur ────────────────────────────
        _print_pair_instructions(pair_info)

        # ── Attente de la liaison manuelle ────────────────────────────────────────
        _wait_for_connected(popup)

    # ── Démarrage du surf ─────────────────────────────────────────────────────
    _start_surf(popup)

    # ── Maintien en vie ───────────────────────────────────────────────────────
    _keep_alive(context)


# ── Étape 1 : ID de l'extension ───────────────────────────────────────────────

def _get_extension_id(context: BrowserContext) -> str:
    """
    Récupère l'ID runtime de l'extension depuis son service worker.

    Les service workers MV3 sont exposés via ``context.service_workers``.
    URL attendue : ``chrome-extension://<32 chars>/sw.js``.
    Attente jusqu'à 15 s.
    """
    log.info("Recherche du service worker de l'extension PR.surf…")

    for _ in range(30):
        for sw in context.service_workers:
            m = re.match(r"chrome-extension://([a-z]{32})/", sw.url)
            if m:
                return m.group(1)
        time.sleep(0.5)

    # Repli : scan des pages ouvertes
    for page in context.pages:
        m = re.match(r"chrome-extension://([a-z]{32})/", page.url)
        if m:
            return m.group(1)

    raise RuntimeError(
        "Service worker de l'extension PR.surf introuvable.\n"
        "Vérifiez que l'extension est bien chargée (--load-extension=…) "
        "et que Chrome a eu le temps de démarrer."
    )


# ── Étape 2 : Ouvrir le popup ─────────────────────────────────────────────────

def _open_popup(context: BrowserContext, popup_url: str) -> Page:
    """Ouvre le popup de l'extension dans un onglet dédié."""
    log.info(f"Ouverture du popup : {popup_url}")
    page = context.new_page()
    page.goto(popup_url, wait_until="domcontentloaded")
    page.wait_for_timeout(2_000)
    return page


def _popup_is_connected(popup: Page) -> bool:
    """True si le popup affiche déjà l'interface d'un compte lié."""
    for selector in ("button[data-a='start']", ".money", "button[data-a='stop']"):
        try:
            if popup.locator(selector).count() > 0:
                return True
        except Exception:
            pass
    return False


# ── Étape 3 : Déclencher le pairing ──────────────────────────────────────────

@retry(stop=stop_after_attempt(3), wait=wait_fixed(3))
def _trigger_pairing(popup: Page) -> dict[str, str]:
    """
    Clique le bouton « pair » dans le popup et extrait le code généré.

    Référence popup.js :
      data-a="pair"  → send({ type: 'pair' })
      → sw.js POST /pair → { code, link, until, pt }
      → le popup affiche div.code avec les 8 chiffres dans des <i>

    Returns
    -------
    dict avec 'code' (str, 8 chiffres) et 'link' (str, URL pr.social).
    """
    log.info("Clic sur le bouton de jumelage dans le popup…")

    pair_btn = popup.locator("[data-a='pair']")
    try:
        pair_btn.wait_for(timeout=8_000)
    except PWTimeoutError:
        popup.screenshot(path="debug_popup_initial.png")
        raise RuntimeError(
            "Bouton de jumelage introuvable dans le popup. "
            "Capture d'écran → debug_popup_initial.png"
        )

    pair_btn.click()

    # Attendre l'apparition du code (div.code, chiffres dans des <i>)
    log.info("Attente du code de jumelage…")
    try:
        popup.wait_for_selector("div.code", timeout=20_000)
    except PWTimeoutError:
        popup.screenshot(path="debug_popup_after_pair.png")
        raise RuntimeError(
            "Le code de jumelage n'est pas apparu. "
            "Capture d'écran → debug_popup_after_pair.png"
        )

    # Extraire les chiffres depuis les balises <i> de div.code
    digit_els = popup.locator("div.code i").all_inner_texts()
    code = "".join(d.strip() for d in digit_els if d.strip().isdigit())

    if len(code) < 6:
        # Repli : inner_text brut nettoyé
        raw = popup.locator("div.code").inner_text().strip()
        code = re.sub(r"\D", "", raw)

    if not code:
        popup.screenshot(path="debug_popup_code.png")
        raise RuntimeError(
            "Impossible d'extraire le code depuis div.code. "
            "Capture d'écran → debug_popup_code.png"
        )

    # Le lien est construit par le service worker :
    # SITE_BASE + '/tools?connect=' + code  (sw.js ligne 200)
    link = f"https://pr.social/tools?connect={code}"
    return {"code": code, "link": link}


# ── Étape 4 : Afficher les instructions ──────────────────────────────────────

def _print_pair_instructions(pair_info: dict[str, str]) -> None:
    """Affiche dans le terminal le code et le lien à ouvrir."""
    code = pair_info["code"]
    link = pair_info["link"]
    separator = "─" * 60

    # Formater le code : XXXX-XXXX
    formatted = f"{code[:4]}-{code[4:]}" if len(code) == 8 else code

    log.info(separator)
    log.info("  ACTION REQUISE — Liez votre compte PR.social")
    log.info(separator)
    log.info(f"  Code de connexion : {formatted}")
    log.info(f"  Lien direct       : {link}")
    log.info("")
    log.info("  1. Ouvrez le lien ci-dessus dans votre navigateur")
    log.info("     (ou allez sur pr.social → Outils → Surf)")
    log.info(f"  2. Entrez le code  {formatted}  et confirmez.")
    log.info(f"  3. Le bot continuera automatiquement (délai max : {settings.pair_timeout_s} s).")
    log.info(separator)


# ── Étape 5 : Attendre la confirmation ───────────────────────────────────────

def _wait_for_connected(popup: Page) -> None:
    """
    Attend que l'extension confirme la liaison manuelle.

    sw.js poll GET /pair/<pt> toutes les 3 s :
      state='ok' → stocke la clé → mainView() s'affiche.

    On détecte mainView() par la présence de :
      - button[data-a='start']  (bouton Start)
      - .money                  (widget solde du jour)
    """
    log.info(
        f"En attente de la liaison du compte "
        f"(jusqu'à {settings.pair_timeout_s} s)…"
    )
    deadline = time.time() + settings.pair_timeout_s
    last_log = time.time()

    while time.time() < deadline:
        try:
            popup.wait_for_selector(
                "button[data-a='start'], .money, button[data-a='stop']",
                timeout=4_000,
            )
            log.success("Compte lié — tableau de bord de l'extension affiché !")
            return
        except PWTimeoutError:
            # Log de progression toutes les 30 s
            if time.time() - last_log >= 30:
                remaining = int(deadline - time.time())
                log.info(f"Toujours en attente… ({remaining} s restantes)")
                last_log = time.time()

    raise RuntimeError(
        f"Délai dépassé : le compte n'a pas été lié en {settings.pair_timeout_s} s.\n"
        "Relancez le bot et entrez le code plus rapidement."
    )


# ── Étape 6 : Démarrer le surf ────────────────────────────────────────────────

@retry(stop=stop_after_attempt(3), wait=wait_fixed(3))
def _start_surf(popup: Page) -> None:
    """
    Clique « Start » dans le popup pour lancer le surf.

    popup.js data-a="start" → send({ type: 'start' })
    Chrome peut afficher une boîte native de permission (<all_urls>) ;
    l'utilisateur doit cliquer « Autoriser » si elle apparaît.
    """
    log.info("Clic sur 'Start' pour lancer le surf…")

    start_btn = popup.locator("button[data-a='start']")
    try:
        start_btn.wait_for(timeout=10_000)
    except PWTimeoutError:
        popup.screenshot(path="debug_popup_start.png")
        raise RuntimeError(
            "Bouton 'Start' introuvable. "
            "Capture d'écran → debug_popup_start.png"
        )

    start_btn.click()

    # Attendre que le popup passe en état actif (dot.go = surf en cours)
    try:
        popup.wait_for_selector(
            ".dot.go, [data-a='stop'], [data-a='pause']",
            timeout=15_000,
        )
        log.success("Surf démarré ! L'extension surf de façon autonome.")
    except PWTimeoutError:
        log.warning(
            "Le surf n'a pas encore démarré.\n"
            "Si Chrome affiche une demande de permission, "
            "cliquez manuellement sur 'Autoriser' puis attendez."
        )


# ── Étape 7 : Keep-alive ──────────────────────────────────────────────────────

def _keep_alive(context: BrowserContext) -> None:
    """
    Maintient le processus Python en vie pendant que l'extension surf.

    - Log heartbeat toutes les 60 s.
    - Vérifie que le service worker est toujours actif toutes les 30 s.
    - Arrêt propre sur Ctrl-C.
    """
    log.info("Session de surf en cours — appuyez sur Ctrl-C pour arrêter.")
    heartbeat_interval = 60
    check_interval = 30
    elapsed = 0

    try:
        while True:
            time.sleep(1)
            elapsed += 1

            if elapsed % heartbeat_interval == 0:
                log.info(f"[heartbeat] Surf actif depuis {elapsed // 60} min.")

            if elapsed % check_interval == 0:
                _check_extension_alive(context)

    except KeyboardInterrupt:
        log.info("Interruption clavier — arrêt de la session.")


def _check_extension_alive(context: BrowserContext) -> None:
    """Avertit si le service worker de l'extension a disparu."""
    for sw in context.service_workers:
        if re.match(r"chrome-extension://[a-z]{32}/", sw.url):
            return
    log.warning(
        "Le service worker de l'extension n'est plus actif. "
        "Le surf s'est peut-être arrêté — vérifiez la fenêtre du navigateur."
    )
