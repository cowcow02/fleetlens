#!/usr/bin/env python3
"""Build the Fleetlens customer setup guide with reportlab."""

from __future__ import annotations

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "fleetlens-user-guide.pdf"
SCREENSHOTS = ROOT / "docs" / "assets" / "screenshots"
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
REVIEW_DATE = "2026-07-13"

PAGE_W, PAGE_H = letter
INK = colors.HexColor("#1f2933")
MUTED = colors.HexColor("#52606d")
FAINT = colors.HexColor("#f4f7f8")
LINE = colors.HexColor("#d9e2ec")
TEAL = colors.HexColor("#19a99a")
TEAL_DARK = colors.HexColor("#087f75")
PURPLE = colors.HexColor("#5b4bb7")
AMBER = colors.HexColor("#9a6700")
WHITE = colors.white


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverKicker", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=10, leading=13, textColor=TEAL_DARK, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=31, leading=35, textColor=INK, alignment=TA_LEFT, spaceAfter=14,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica",
    fontSize=14, leading=20, textColor=MUTED, spaceAfter=18,
))
styles.add(ParagraphStyle(
    name="H1Fleet", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=22, leading=27, textColor=INK, spaceBefore=0, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="H2Fleet", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=14, leading=18, textColor=INK, spaceBefore=12, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="H3Fleet", parent=styles["Heading3"], fontName="Helvetica-Bold",
    fontSize=11, leading=14, textColor=TEAL_DARK, spaceBefore=8, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="Badge", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=10, leading=12, textColor=WHITE, alignment=TA_CENTER,
))
styles.add(ParagraphStyle(
    name="BodyFleet", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.4, leading=13.5, textColor=INK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="BodyTight", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8.6, leading=11.5, textColor=INK, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="SmallFleet", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.8, leading=10, textColor=MUTED, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=8.2, leading=10, textColor=WHITE, spaceAfter=0,
))
styles.add(ParagraphStyle(
    name="TableCell", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=8, leading=10.2, textColor=INK, spaceAfter=0,
))
styles.add(ParagraphStyle(
    name="Caption", parent=styles["BodyText"], fontName="Helvetica-Oblique",
    fontSize=7.5, leading=9.5, textColor=MUTED, alignment=TA_CENTER,
    spaceBefore=4, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="CodeLabel", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=8, leading=10, textColor=TEAL_DARK, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="CalloutTitle", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=9.2, leading=12, textColor=INK, spaceAfter=3,
))


def P(text: str, style: str = "BodyFleet") -> Paragraph:
    return Paragraph(text, styles[style])


def bullets(items: list[str], style: str = "BodyTight") -> ListFlowable:
    return ListFlowable(
        [ListItem(P(item, style), leftIndent=0) for item in items],
        bulletType="bullet",
        start="circle",
        leftIndent=15,
        bulletFontName="Helvetica",
        bulletFontSize=7,
        bulletOffsetY=1,
        spaceAfter=5,
    )


def code_block(label: str, text: str) -> Table:
    block = Table([
        [P(label.upper(), "CodeLabel")],
        [Preformatted(text.strip("\n"), ParagraphStyle(
            name=f"Code_{label}", fontName="Courier", fontSize=8.1,
            leading=11, textColor=INK, leftIndent=0, rightIndent=0,
        ))],
    ], colWidths=[6.55 * inch])
    block.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), FAINT),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
        ("TOPPADDING", (0, 1), (-1, 1), 3),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 9),
    ]))
    return block


def callout(title: str, body: str, bg=colors.HexColor("#eef9f7"), accent=TEAL) -> Table:
    box = Table([[P(title, "CalloutTitle")], [P(body, "BodyTight")]], colWidths=[6.55 * inch])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.7, accent),
        ("LINEBEFORE", (0, 0), (0, -1), 4, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, 0), 9),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 9),
    ]))
    return box


def step(number: str, title: str, body: str) -> Table:
    badge = Table([[P(number, "Badge")]], colWidths=[0.38 * inch], rowHeights=[0.36 * inch])
    badge.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TEAL),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    body_cell = [P(f"<b>{title}</b>", "BodyFleet"), P(body, "BodyTight")]
    t = Table([[badge, body_cell]], colWidths=[0.5 * inch, 6.05 * inch])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), 8),
        ("LEFTPADDING", (1, 0), (1, -1), 0),
        ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def table(headers: list[str], rows: list[list[str]], widths: list[float]) -> Table:
    data = [[P(h, "TableHead") for h in headers]]
    data.extend([[P(cell, "TableCell") for cell in row] for row in rows])
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, FAINT]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def screenshot(name: str, caption: str) -> list[object]:
    path = SCREENSHOTS / f"{name}.png"
    reader = ImageReader(str(path))
    width, height = reader.getSize()
    max_width = 6.55 * inch
    scale = min(1.0, max_width / width)
    image = Image(str(path), width=width * scale, height=height * scale)
    image.hAlign = "CENTER"
    return [image, P(caption, "Caption")]


def page_chrome(canvas, doc):
    canvas.saveState()
    if doc.page == 1:
        canvas.setFillColor(TEAL)
        canvas.rect(0, PAGE_H - 0.18 * inch, PAGE_W, 0.18 * inch, stroke=0, fill=1)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(0.7 * inch, 0.43 * inch, "Fleetlens | customer setup guide")
        canvas.drawRightString(PAGE_W - 0.7 * inch, 0.43 * inch, f"Reviewed {REVIEW_DATE}")
    else:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(0.7 * inch, PAGE_H - 0.48 * inch, PAGE_W - 0.7 * inch, PAGE_H - 0.48 * inch)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(0.7 * inch, 0.43 * inch, "Fleetlens | customer setup guide")
        canvas.drawRightString(PAGE_W - 0.7 * inch, 0.43 * inch, f"{doc.page}")
    canvas.restoreState()


def build_story() -> list[object]:
    story: list[object] = []

    # Cover
    story += [Spacer(1, 0.3 * inch), P("FLEETLENS CUSTOMER SETUP GUIDE", "CoverKicker")]
    story += [P("From your first terminal command to your first team sync.", "CoverTitle")]
    story += [P(
        "A beginner-first walkthrough for installing Fleetlens, seeing your first local session, and sending a chosen project rollup to Team Edition.",
        "CoverSub",
    )]
    story += [Spacer(1, 0.14 * inch)]
    cover = Table([
        [P("LOCAL CHECKPOINT", "TableHead"), P("TEAM CHECKPOINT", "TableHead")],
        [
            P("You can open localhost, see a session, and understand the local dashboard.", "BodyTight"),
            P("You have paired your machine, chosen projects, and confirmed the first aggregate push.", "BodyTight"),
        ],
        ], colWidths=[3.22 * inch, 3.22 * inch],
    )
    cover.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("BACKGROUND", (0, 1), (-1, 1), FAINT),
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story += [cover, Spacer(1, 0.3 * inch)]
    story += [P(f"For Fleetlens {VERSION}", "H2Fleet")]
    story += [P(
        "This handout is intentionally standalone. You can follow it without knowing what a shell, daemon, JSONL file, or local server is. Work through the checkpoints in order; each one gives you a visible sign that you are ready for the next.",
    )]
    story += [P("You will need", "H2Fleet")]
    story += [bullets([
        "A Mac, Windows PC, or Linux computer with permission to install software.",
        "An internet connection for the first installation.",
        "At least one coding agent installed and authenticated. Fleetlens observes an agent; it does not replace or install one.",
        "For Team Edition: a server URL and private device token from your team admin.",
    ])]
    story += [callout(
        "Finish line",
        "You are done when the local Team page shows a successful pairing and the Team Edition dashboard shows a rollup for one project or day. A new machine with no previous agent history can still finish successfully; its first activity will arrive after the next agent session.",
    )]
    story += [PageBreak()]

    # Page 2
    story += [P("Before you start: four words", "H1Fleet")]
    story += [P("These are the only concepts you need before the first command.")]
    story += [table(
        ["Word", "Plain-language meaning"],
        [
            ["Terminal", "A text window where you give the computer instructions by typing commands."],
            ["Coding agent", "The AI tool you already use to work in a project. It writes local session history that Fleetlens can read."],
            ["Fleetlens", "A local dashboard and analytics layer that reads agent history; it is not the coding agent."],
            ["Team Edition", "An optional shared server that receives selected, derived rollups from paired machines."],
        ],
        [1.35 * inch, 5.2 * inch],
    )]
    story += [P("If this computer has no agent yet", "H2Fleet")]
    story += [P(
        "Choose the coding agent your team uses and follow that provider's official install and sign-in instructions first. Fleetlens supports Claude Code, Codex, GitHub Copilot CLI, Gemini CLI, Antigravity, Cowork, and Grok Build sources. The exact agent installation command changes over time, so use the provider's current instructions rather than copying an old command from a screenshot.",
    )]
    story += [P("What happens to your data", "H2Fleet")]
    story += [bullets([
        "The local dashboard reads transcript history from the agent's own local folder.",
        "Raw transcripts, prompts, assistant responses, absolute paths, and file contents stay on this machine.",
        "Team Edition receives only the selected aggregate data described during onboarding.",
        "You can change the selected projects or leave the team later.",
    ])]
    story += [callout(
        "Ask your admin for these exact values",
        "Before you start Team Edition setup, request the server URL, the device token, and any project-sharing policy your team follows. Keep the token private; it is a credential for this machine.",
        bg=colors.HexColor("#fff8e6"), accent=AMBER,
    )]
    story += [PageBreak()]

    # Page 3
    story += [P("1. Open a terminal and check your computer", "H1Fleet")]
    story += [P("A terminal is just a text window. You will paste one command block at a time and press Enter.")]
    story += [table(
        ["Computer", "How to open it"],
        [
            ["macOS", "Press Command + Space, type Terminal, and press Enter."],
            ["Windows", "Open Start, search for Windows Terminal or PowerShell, and open it."],
            ["Linux", "Open your application menu and search for Terminal. Many desktops also use Ctrl + Alt + T."],
        ],
        [1.2 * inch, 5.35 * inch],
    )]
    story += [P("Find the prompt", "H2Fleet")]
    story += [P(
        "The prompt is the short text immediately before the blinking cursor. It may end in a dollar sign, percent sign, or greater-than sign. Type after it; do not type the prompt itself. Commands are case-sensitive.",
    )]
    story += [code_block("Check Node.js and npm", "node --version\nnpm --version")]
    story += [P("You should see two version numbers. Fleetlens requires Node.js 20 or newer.")]
    story += [callout(
        "If the command is not found",
        "Install the current Node.js LTS release from https://nodejs.org/en/download. Choose the installer for your operating system, accept the defaults, close this terminal, open a new terminal, and run the two version commands again.",
        bg=colors.HexColor("#fff8e6"), accent=AMBER,
    )]
    story += [P("Terminal etiquette for beginners", "H2Fleet")]
    story += [bullets([
        "Paste one code block, then wait for it to finish before running the next.",
        "When a password is requested, the cursor may not move and no characters may appear. Type the password and press Enter.",
        "If you see an error, stop and read the first line that describes the problem. Do not keep pasting commands after a failed step.",
    ])]
    story += [PageBreak()]

    # Page 4
    story += [P("2. Install Fleetlens", "H1Fleet")]
    story += [P("The published npm package installs the command, parser, local dashboard bundle, and background worker.")]
    story += [step("1", "Install the command", "Paste this command into the terminal and wait for npm to finish.")]
    story += [code_block("Terminal", "npm install --global fleetlens")]
    story += [step("2", "Check the installed version", "This confirms that the command is now available in your PATH.")]
    story += [code_block("Terminal", "fleetlens version")]
    story += [step("3", "Keep the terminal open", "You will use this same window to start the local dashboard and later confirm the first team push.")]
    story += [callout(
        "If npm reports permission denied",
        "The safest beginner fix is to install Node.js with the official installer or a Node version manager, then repeat the global install. On a managed work computer, ask your administrator to install Fleetlens. Avoid copying an unreviewed permission command from a forum.",
        bg=colors.HexColor("#fff8e6"), accent=AMBER,
    )]
    story += [P("Checkpoint", "H2Fleet"), P("When <font name='Courier'>fleetlens version</font> prints a version number, Fleetlens is installed. Continue even if the dashboard is not showing data yet; it needs an agent session first.")]
    story += [PageBreak()]

    # Page 5
    story += [P("3. Open the local dashboard", "H1Fleet")]
    story += [P("The local edition runs on this computer. It does not need an account, database, or public URL.")]
    story += [step("1", "Start both local services", "The normal start command launches the web dashboard and the background usage daemon together.")]
    story += [code_block("Terminal", "fleetlens start --open")]
    story += [step("2", "Open the address", "If your browser does not open automatically, type the printed address into the browser. The default is http://localhost:3321.")]
    story += [step("3", "Leave it running", "Keep this terminal window open during setup. Later, fleetlens stop will stop both services safely.")]
    story += [callout(
        "If port 3321 is busy",
        "Choose another port and open the URL printed by the command: <font name='Courier'>fleetlens start --port 4400</font>. The alternative is <font name='Courier'>CCLENS_PORT=4400 fleetlens start</font>.",
    )]
    story += [Spacer(1, 0.08 * inch)]
    story += screenshot("overview", "Figure 1. The Overview checkpoint, shown with synthetic fixture data.")
    story += [P("A blank Overview is not an installation failure. It means Fleetlens has not found a completed local agent session yet.", "SmallFleet")]
    story += [PageBreak()]

    # Page 6
    story += [P("4. Make your first session appear", "H1Fleet")]
    story += [P(
        "Fleetlens has no import button because it reads the files your coding agent already creates. Use your normal agent workflow in a project, then return to the dashboard.",
    )]
    story += [P("A safe first task", "H2Fleet")]
    story += [bullets([
        "Open a project that does not contain confidential material, or use a small test folder.",
        "Ask your coding agent to explain a README, list files, or make a tiny harmless change.",
        "Let the agent complete at least one turn so a session record is written.",
        "Return to Fleetlens and open Sessions. The new session should appear after the local file watcher or a page refresh runs.",
    ])]
    story += screenshot("sessions", "Figure 2. Sessions view with synthetic fixture data; real sessions will use your projects and agent names.")
    story += [P("The dashboard pages you will use first", "H2Fleet")]
    story += [table(
        ["Page", "What it answers"],
        [
            ["Overview", "How much happened, where, and when?"],
            ["Sessions", "What did a particular agent run do?"],
            ["Projects", "Which repositories are consuming attention?"],
            ["Day", "When did work overlap or go idle?"],
            ["Usage", "How are provider limits changing over time?"],
            ["Team", "What is this machine sharing?"],
        ],
        [1.35 * inch, 5.2 * inch],
    )]
    story += [PageBreak()]

    # Page 7
    story += [P("5. Get ready for Team Edition", "H1Fleet")]
    story += [P("Team Edition is optional. The local dashboard is already useful on its own; this step adds a shared destination for selected rollups.")]
    story += [P("Your admin's handoff", "H2Fleet")]
    story += [table(
        ["You receive", "What it is for"],
        [
            ["Server URL", "The Team Edition address, such as https://fleetlens.example.com."],
            ["Device token", "A private credential that pairs this computer to your membership."],
            ["Project policy", "A reminder of which repositories your team allows members to share."],
        ],
        [1.45 * inch, 5.1 * inch],
    )]
    story += [P("What Team Edition receives", "H2Fleet")]
    story += [bullets([
        "Daily totals such as agent time, session count, tool calls, turns, and token totals.",
        "Selected project labels and derived counts such as working shape, skills, subagents, PRs, commits, and pushes.",
        "Plan utilization snapshots and sync health information.",
        "Optional locally-derived outcome and helpfulness aggregates.",
    ])]
    story += [P("What remains here", "H2Fleet")]
    story += [bullets([
        "Raw transcripts, prompts, and assistant responses.",
        "Absolute paths, file contents, and tool-call payloads.",
        "Anything in a project you exclude during onboarding.",
    ])]
    story += [callout(
        "Nothing syncs before you choose",
        "The browser onboarding wizard shows this boundary before the first push. You can stop, go back, or leave the team later.",
        bg=colors.HexColor("#f3f0ff"), accent=PURPLE,
    )]
    story += [PageBreak()]

    # Page 8
    story += [P("6. Pair your machine", "H1Fleet")]
    story += [P("Pairing records the server and member on this machine, then opens a local browser wizard. The browser wizard is where you choose the sync scope.")]
    story += [step("1", "Paste the join command", "Replace both placeholders with the URL and device token from your admin. Keep the angle brackets out of the final command.")]
    story += [code_block("Terminal", "fleetlens team join <server-url> <device-token>")]
    story += [step("2", "Wait for the browser", "The CLI checks the token, starts the local dashboard if needed, and opens http://localhost:3321/team/onboarding.")]
    story += [step("3", "Do not expect a push yet", "The paired daemon is held in setup-pending mode until you finish the browser wizard and press Start syncing.")]
    story += [callout(
        "Keep the token private",
        "A device token is a credential. Do not put a real token in a screenshot, public issue, shared document, or copied example. Ask the admin to revoke it if it is exposed.",
        bg=colors.HexColor("#fff8e6"), accent=AMBER,
    )]
    story += [Spacer(1, 0.08 * inch)]
    story += screenshot("team", "Figure 3. The local Team page before pairing, shown with synthetic fixture data.")
    story += [PageBreak()]

    # Page 9
    story += [P("7. Choose projects and start the first sync", "H1Fleet")]
    story += [P("The browser wizard has three steps. Read each screen; it is the safest way to confirm what your machine will share.")]
    story += [step("1", "What happens", "Review the shared aggregate list and the local-only list. Choose Continue when the boundary matches your team's policy.")]
    story += [step("2", "Choose projects", "Deselect private repositories. You can sync selected projects only, or allow new projects automatically if that is appropriate for your team.")]
    story += [step("3", "Start syncing", "Review the project count and choose Start syncing. This is the explicit moment that the first history backfill begins.")]
    story += [P("The progress screen", "H2Fleet")]
    story += [bullets([
        "Usage history is checked first when available.",
        "Local days are pushed one by one and the browser reports pushed, queued, or rejected outcomes.",
        "A machine with no old activity can finish with zero days pushed. That is a valid first setup.",
        "After setup, the daemon checks for new activity about every five minutes.",
    ])]
    story += [callout(
        "If you need to change your mind",
        "Use Back before Start syncing to adjust the project list. After setup, change it from the local Team page; excluded projects stay private and future payloads are rebuilt around the new selection.",
    )]
    story += [PageBreak()]

    # Page 10
    story += [P("8. Confirm the first team push", "H1Fleet")]
    story += [P("You have completed the setup when the browser reports success and the local CLI can describe the pairing.")]
    story += [code_block("Verify locally", "fleetlens team status\nfleetlens team logs")]
    story += [P("Look for these signs:", "H2Fleet")]
    story += [bullets([
        "The status says the machine is paired with the expected team and server.",
        "The project selection matches the choices you made.",
        "The last pushed day changes when there is local activity to send.",
        "The team dashboard shows a derived project or daily rollup after it processes the push.",
    ])]
    story += [P("Push immediately when needed", "H2Fleet")]
    story += [code_block("Terminal", "fleetlens team sync")]
    story += [P("The daemon will continue to push on its normal interval. If the server is temporarily unavailable, local analytics continue to work and supported payloads are queued for retry.")]
    story += [P("Leave or disconnect", "H2Fleet")]
    story += [code_block("Terminal", "fleetlens team leave")]
    story += [callout(
        "No local history yet",
        "A successful pairing with zero pushed days is expected for a new machine. Run a normal agent task, wait for its session to appear locally, then run fleetlens team sync to verify the first non-empty rollup.",
        bg=colors.HexColor("#f3f0ff"), accent=PURPLE,
    )]
    story += [PageBreak()]

    # Page 11
    story += [P("9. What keeps running locally", "H1Fleet")]
    story += [P("Fleetlens has a web process for the dashboard and a detached daemon for usage polling, perception work, and team sync.")]
    story += [P("Useful checks", "H2Fleet")]
    story += [code_block("Terminal", "fleetlens status\nfleetlens daemon status\nfleetlens daemon logs\nfleetlens usage")]
    story += [P("Local state", "H2Fleet")]
    story += [table(
        ["Path", "Purpose"],
        [
            ["~/.cclens/pid", "Web process PID, port, and version."],
            ["~/.cclens/daemon.pid", "Usage and sync worker PID."],
            ["~/.cclens/usage.jsonl", "Append-only provider usage snapshots."],
            ["~/.cclens/daemon.log", "Usage, perception, update, and team messages."],
            ["~/.cclens/entries/", "Day-scoped local work units used by digests."],
            ["~/.cclens/digests/", "Saved day, week, and month digest artifacts."],
            ["~/.cclens/team-config.json", "Pairing identity, server URL, token, and project scope."],
        ],
        [2.35 * inch, 4.2 * inch],
    )]
    story += [callout(
        "Stopping is safe",
        "fleetlens stop stops both local services. It does not delete agent transcript history or the local state directory. Run fleetlens start again when you want the dashboard back.",
    )]
    story += [P("Update as one bundle", "H2Fleet")]
    story += [code_block("Terminal", "fleetlens update")]
    story += [P("The updater installs the latest CLI and hands control to the fresh binary so the web server and daemon do not remain on different versions.")]
    story += [PageBreak()]

    # Page 12
    story += [P("10. Troubleshooting for first-time users", "H1Fleet")]
    story += [P("Start with the smallest check. If the first command fails, do not continue to later steps until it is resolved.")]
    story += [table(
        ["What you see", "Try first", "Then"],
        [
            ["node or npm is not found", "Install Node.js LTS and reopen the terminal.", "Run node --version and npm --version again."],
            ["npm permission denied", "Use the official Node installer or ask an administrator.", "Repeat npm install --global fleetlens."],
            ["Browser did not open", "Open http://localhost:3321 manually.", "Check fleetlens status and the printed port."],
            ["Dashboard is empty", "Run one completed task with a supported agent.", "Refresh, then check the agent's local history root."],
            ["Port is already in use", "Run fleetlens start --port 4400.", "Open the URL printed by Fleetlens."],
            ["Token rejected", "Check the server URL and token characters.", "Ask the admin to revoke and issue a new token."],
            ["Nothing syncs after join", "Open /team/onboarding and finish all three steps.", "Run fleetlens team status, then fleetlens team sync."],
            ["First sync shows zero days", "Run a new agent session.", "Wait for it locally, then run fleetlens team sync."],
            ["No usage meter", "Run fleetlens daemon status and daemon logs.", "Sign in to the provider and wait for the next poll."],
        ],
        [1.45 * inch, 2.45 * inch, 2.65 * inch],
    )]
    story += [Spacer(1, 0.16 * inch)]
    story += [callout(
        "When asking for help",
        "Capture the command, the exact error, and a redacted excerpt of fleetlens daemon logs. Remove device tokens, private paths, project names, prompts, and file contents before sharing.",
        bg=colors.HexColor("#fff8e6"), accent=AMBER,
    )]
    story += [PageBreak()]

    # Page 13
    story += [P("11. Privacy boundary", "H1Fleet")]
    story += [P("Use this table as the final check before pressing Start syncing.")]
    story += [table(
        ["Data", "Stays local", "Team Edition"],
        [
            ["Raw transcripts", "Read by the local parser and dashboard.", "Not uploaded."],
            ["Prompts and assistant responses", "Remain in provider-local history.", "Not uploaded."],
            ["Absolute paths and file contents", "May support local project signals.", "Not uploaded."],
            ["Daily metrics", "Computed from local session history.", "Shared for selected projects."],
            ["Rich project rollups", "Derived from local entries and signals.", "Shared as labels and counts."],
            ["Usage snapshots", "Stored in ~/.cclens/usage.jsonl.", "Shared for the paired member."],
            ["Excluded projects", "Remain available only on this machine.", "Not part of future sync payloads."],
            ["AI enrichment", "Runs through local AI features when enabled.", "Derived extras may be included; raw conversation is not the sync contract."],
        ],
        [1.65 * inch, 2.35 * inch, 2.55 * inch],
    )]
    story += [Spacer(1, 0.2 * inch)]
    story += [P("Your controls", "H2Fleet")]
    story += [bullets([
        "Choose or exclude projects during onboarding.",
        "Review the selection and last push on the local Team page.",
        "Use fleetlens team sync to push intentionally.",
        "Use fleetlens team leave to stop future team syncs.",
        "Ask your admin to revoke a token if it is exposed or no longer needed.",
    ])]
    story += [callout(
        "Admin responsibility",
        "Your team admin protects the Team Edition URL, Postgres database, encryption key, member access, and device-token lifecycle. The member controls which local projects are selected.",
        bg=colors.HexColor("#f3f0ff"), accent=PURPLE,
    )]
    story += [PageBreak()]

    # Page 14
    story += [P("12. Quick reference", "H1Fleet")]
    story += [P("The commands most customers need after the first successful setup.")]
    story += [table(
        ["Command", "Purpose"],
        [
            ["fleetlens start --open", "Start the local dashboard and daemon, then open the browser."],
            ["fleetlens stop", "Stop both local services."],
            ["fleetlens status", "Check the local server and daemon."],
            ["fleetlens daemon logs", "Read recent usage, perception, and sync messages."],
            ["fleetlens team status", "Check pairing, selected projects, and last push."],
            ["fleetlens team sync", "Push unsynced local activity now."],
            ["fleetlens team logs", "Read recent Team Edition sync outcomes."],
            ["fleetlens team leave", "Unpair the machine and stop future team sync."],
            ["fleetlens update", "Update the CLI and restart stale local services."],
        ],
        [2.45 * inch, 4.1 * inch],
    )]
    story += [P("Your completion checklist", "H2Fleet")]
    story += [bullets([
        "Node.js and npm are installed.",
        "fleetlens version prints a version.",
        "The local Overview shows at least one session after an agent task.",
        "The Team onboarding wizard shows the intended project scope.",
        "Start syncing completes and fleetlens team status reports the pairing.",
        "The team dashboard shows the first derived rollup, or you know a new local session is needed first.",
    ])]
    story += [Spacer(1, 0.2 * inch)]
    story += [callout(
        "The one-line mental model",
        "Your agent writes local history. Fleetlens reads and analyzes it locally. You choose a project scope. Team Edition receives derived rollups, not raw transcripts.",
    )]
    story += [Spacer(1, 0.25 * inch), P(f"Fleetlens {VERSION} | customer setup guide | reviewed {REVIEW_DATE}", "SmallFleet")]
    return story


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frame = Frame(
        0.7 * inch,
        0.68 * inch,
        PAGE_W - 1.4 * inch,
        PAGE_H - 1.32 * inch,
        id="body",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    doc = BaseDocTemplate(
        str(OUT), pagesize=letter, leftMargin=0.7 * inch, rightMargin=0.7 * inch,
        topMargin=0.68 * inch, bottomMargin=0.68 * inch,
        title="Fleetlens Customer Setup Guide", author="Fleetlens",
    )
    doc.addPageTemplates([PageTemplate(id="fleetlens", frames=[frame], onPage=page_chrome)])
    doc.build(build_story())
    print(OUT)


if __name__ == "__main__":
    main()
