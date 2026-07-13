#!/usr/bin/env python3
"""Build the Fleetlens setup guide PDF with reportlab."""

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
    KeepTogether,
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
VERSION = json.loads((ROOT / "package.json").read_text())['version']
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
    fontSize=32, leading=36, textColor=INK, alignment=TA_LEFT, spaceAfter=14,
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
    name="TableCellMono", parent=styles["BodyText"], fontName="Courier",
    fontSize=7.4, leading=9.2, textColor=INK, spaceAfter=0,
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
    badge = Table([[P(number, "H3Fleet")]], colWidths=[0.38 * inch], rowHeights=[0.36 * inch])
    badge.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TEAL),
        ("BOX", (0, 0), (-1, -1), 0, TEAL),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TEXTCOLOR", (0, 0), (-1, -1), WHITE),
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
    for row in rows:
        data.append([P(cell, "TableCellMono" if cell.startswith("~") or "fleetlens " in cell else "TableCell") for cell in row])
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
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
        canvas.drawString(0.7 * inch, 0.43 * inch, "Fleetlens | setup guide")
        canvas.drawRightString(PAGE_W - 0.7 * inch, 0.43 * inch, f"Reviewed {REVIEW_DATE}")
    else:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(0.7 * inch, PAGE_H - 0.48 * inch, PAGE_W - 0.7 * inch, PAGE_H - 0.48 * inch)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(0.7 * inch, 0.43 * inch, "Fleetlens | user guide")
        canvas.drawRightString(PAGE_W - 0.7 * inch, 0.43 * inch, f"{doc.page}")
    canvas.restoreState()


def build_story() -> list[object]:
    story: list[object] = []

    # Cover
    story += [Spacer(1, 0.36 * inch), P("FLEETLENS USER GUIDE", "CoverKicker")]
    story += [P("Set up Fleetlens and start reading your agent fleet.", "CoverTitle")]
    story += [P(
        "A practical first-run guide for the local dashboard, usage daemon, and optional Team Edition.",
        "CoverSub",
    )]
    story += [Spacer(1, 0.18 * inch)]
    cover = Table([
        [P("LOCAL EDITION", "TableHead"), P("TEAM EDITION", "TableHead")],
        [
            P("One machine. Private by default. Reads local coding-agent session files and keeps the dashboard on localhost.", "BodyTight"),
            P("Shared visibility. An admin runs the server and teammates pair their local Fleetlens daemons to it.", "BodyTight"),
        ],
    ], colWidths=[3.22 * inch, 3.22 * inch])
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
    story += [cover, Spacer(1, 0.38 * inch)]
    story += [P(f"For Fleetlens {VERSION}", "H2Fleet")]
    story += [P(
        "The shortest path is: install the CLI, run <font name='Courier'>fleetlens start</font>, then open the URL it prints. You do not need to create an account for the local edition.",
        "BodyFleet",
    )]
    story += [code_block("Quick start", "npm install -g fleetlens\nfleetlens start --open")]
    story += [Spacer(1, 0.24 * inch)]
    story += [callout(
        "Which path should I use?",
        "Start with the Local Edition if you are exploring Fleetlens or working alone. Choose Team Edition when multiple people need a shared dashboard and project-level rollups.",
    )]
    story += [PageBreak()]

    # Page 2
    story += [P("1. Before you start", "H1Fleet")]
    story += [P(
        "Fleetlens is a local-first reader and analytics layer. The local dashboard does not require a database, a hosted account, or a project import step. It discovers the session files that your coding agents already write.",
    )]
    story += [P("Prerequisites", "H2Fleet")]
    story += [bullets([
        "Node.js 20 or newer and npm. The published CLI is the easiest install path.",
        "At least one supported agent with local session history. An empty machine still starts successfully; the dashboard will simply show no sessions yet.",
        "For plan utilization, keep the relevant agent logged in. Claude Code usage is read through its existing OAuth credential; other providers expose their own local or configured usage sources.",
        "For Team Edition, an admin needs a deployed server URL and an invite or device token for each member.",
    ])]
    story += [P("What Fleetlens can read locally", "H2Fleet")]
    story += [table(
        ["Source", "Local data", "What appears"],
        [
            ["Claude Code", "~/.claude/projects", "Sessions, transcripts, usage, projects, PR signals"],
            ["Codex", "~/.codex/sessions", "Sessions, transcripts, projects, local usage when available"],
            ["Gemini CLI", "~/.gemini/tmp", "Session analytics and detail"],
            ["Antigravity", "~/.gemini/antigravity-cli", "Session analytics and detail"],
            ["Cowork", "Local Cowork mirror", "Session analytics and detail"],
            ["Grok Build", "~/.grok/sessions or GROK_HOME", "Sessions and weekly usage when logged in"],
            ["Z.ai", "Configured API key", "Plan usage only; no local transcript source"],
        ],
        [1.05 * inch, 2.05 * inch, 3.45 * inch],
    )]
    story += [Spacer(1, 0.12 * inch), callout(
        "Privacy baseline",
        "Local transcript files stay on the machine. The usage daemon still makes the provider requests required for plan meters. Optional AI features invoke the local claude CLI rather than sending raw transcripts to a Fleetlens service.",
        bg=colors.HexColor("#fff8e6"), accent=AMBER,
    )]
    story += [PageBreak()]

    # Page 3
    story += [P("2. Install and open the local dashboard", "H1Fleet")]
    story += [P("The first-run path takes a minute or two and is safe to repeat.", "BodyFleet")]
    story += [step("1", "Install the published CLI", "Run the global install from a terminal. The npm package contains the CLI, parser, usage worker, and bundled Next.js dashboard."), code_block("Terminal", "npm install -g fleetlens\nfleetlens version"), Spacer(1, 0.08 * inch)]
    story += [step("2", "Start Fleetlens", "Start launches the local web server and the background usage daemon together. Add --open if you want Fleetlens to launch your browser."), code_block("Terminal", "fleetlens start\n# or\nfleetlens start --open"), Spacer(1, 0.08 * inch)]
    story += [step("3", "Open the printed URL", "The default address is http://localhost:3321. If you selected another port, use the URL printed by the CLI."), Spacer(1, 0.08 * inch)]
    story += [step("4", "Run an agent session", "Fleetlens reads the agent's local files as they change. Refreshing is normally unnecessary because the dashboard listens for file events and refreshes its server-rendered data."), Spacer(1, 0.12 * inch)]
    story += [callout(
        "If you only want the web server",
        "Use <font name='Courier'>fleetlens start --no-daemon</font>. You can later manage the worker independently with <font name='Courier'>fleetlens daemon start</font>.",
    )]
    story += [Spacer(1, 0.15 * inch), PageBreak()]
    story += [P("What the local dashboard looks like", "H1Fleet")]
    story += [P(
        "The first screen gives you a compact read on sessions, agent time, tools, concurrency, code changes, cost, and daily activity. The numbers below come from a sanitized fixture used only for this guide.",
    )]
    story += screenshot("overview", "Figure 1. Overview with synthetic local fixture data. No personal transcript or project names are used.")
    story += [PageBreak()]

    # Page 4
    story += [P("3. Read the dashboard", "H1Fleet")]
    story += [P(
        "Fleetlens normalizes different agent transcript formats into one session model. The dashboard can therefore compare sessions, projects, agent time, tool calls, turns, tokens, code changes, estimated cost, and concurrency in one place.",
    )]
    story += [P("Primary pages", "H2Fleet")]
    story += [table(
        ["Page", "Use it for"],
        [
            ["Overview /", "Headline metrics, heatmap, daily activity, projects, recent sessions"],
            ["All sessions /sessions", "Search, filter, sort, and open individual transcript views"],
            ["Projects /projects", "Roll up activity by canonical project; worktrees fold into the parent repo"],
            ["Day /day", "Inspect daily activity, timeline, and concurrency bursts"],
            ["Insights /insights", "Read day/week/month digests when entries and AI features are enabled"],
            ["Agent /agent", "Ask questions over local session history and create handoff prompts"],
            ["Usage /usage", "Review historical plan utilization by agent"],
            ["Settings /settings", "Manage auto-start, menu bar widget, Z.ai credentials, and AI features"],
            ["Team /team", "Pairing status, sync selection, last push, and data boundary"],
        ],
        [1.55 * inch, 5 * inch],
    )]
    story += [Spacer(1, 0.16 * inch)]
    story += screenshot("sessions", "Figure 2. All sessions view: search, project filter, card/table toggle, and session-level metrics.")
    story += [P(
        "Agent time is active event time, not wall-clock time. Long gaps between transcript events are treated as idle, so the headline duration is more useful for understanding actual agent work.",
        "SmallFleet",
    )]
    story += [PageBreak()]

    # Page 5
    story += [P("4. Usage tracking and the background daemon", "H1Fleet")]
    story += [P(
        "The daemon is a detached process that keeps plan snapshots in Fleetlens's local state directory. The dashboard's usage sidebar shows the latest snapshot; the Usage page charts historical snapshots and cycle boundaries.",
    )]
    story += [P("Useful checks", "H2Fleet")]
    story += [code_block("Terminal", "fleetlens status\nfleetlens daemon status\nfleetlens daemon logs\nfleetlens usage\nfleetlens usage --history")]
    story += [Spacer(1, 0.14 * inch)]
    story += [P("State files", "H2Fleet")]
    story += [table(
        ["Path", "Purpose"],
        [
            ["~/.cclens/pid", "Local web-server PID and port"],
            ["~/.cclens/daemon.pid", "Usage daemon PID"],
            ["~/.cclens/usage.jsonl", "Append-only usage snapshots"],
            ["~/.cclens/daemon.log", "Recent daemon and sync messages"],
            ["~/.cclens/entries/", "Day-scoped perception entries used by digests"],
            ["~/.cclens/digests/", "Saved day, week, and month digest artifacts"],
        ],
        [2.35 * inch, 4.2 * inch],
    )]
    story += [Spacer(1, 0.16 * inch)]
    story += [callout(
        "No usage snapshot yet?",
        "The dashboard can still analyze transcripts. Check <font name='Courier'>fleetlens daemon status</font>, make sure the provider CLI is logged in, then inspect <font name='Courier'>fleetlens daemon logs</font>. Agents without a structured usage endpoint will not show a plan meter.",
        bg=colors.HexColor("#fff8e6"), accent=AMBER,
    )]
    story += [P("Optional macOS conveniences", "H2Fleet")]
    story += [bullets([
        "Settings can install the native menu bar widget when the bundled widget is present.",
        "The CLI can install daemon auto-start with fleetlens autostart install, or the settings page can enable it.",
        "The daemon also drives perception sweeps and, when enabled, backfills digest work in the background.",
    ])]
    story += [PageBreak()]

    # Page 6
    story += [P("5. Optional Team Edition", "H1Fleet")]
    story += [P(
        "Team Edition is a self-hosted Fleetlens server for shared rollups. The local CLI remains the source of truth for raw sessions; each paired machine chooses what project aggregates to sync.",
    )]
    story += [P("Admin flow", "H2Fleet")]
    story += [bullets([
        "Deploy the Team Edition with the Railway template, Google Cloud installer, Docker Compose, or the AWS Terraform module.",
        "Open the server URL and create the first account. The first account becomes the admin of the first team.",
        "Create an invite or device token from the team server's settings area and send it to each teammate.",
    ])]
    story += [P("Member flow", "H2Fleet")]
    story += [code_block("Terminal", "fleetlens team join https://your-fleetlens.example <invite-token>\nfleetlens team status\nfleetlens team sync")]
    story += [P(
        "The join command opens the browser setup flow. Finish onboarding to select the projects that may sync. For a non-interactive first sync, use <font name='Courier'>fleetlens team join &lt;url&gt; &lt;token&gt; --no-browser</font>.",
    )]
    story += [P("Common team commands", "H2Fleet")]
    story += [table(
        ["Command", "Result"],
        [
            ["fleetlens team status", "Pairing state, selected projects, and last sync"],
            ["fleetlens team sync", "Push unsynced days immediately"],
            ["fleetlens team backfill", "Re-upload local usage history for the shared dashboard"],
            ["fleetlens team logs", "Show recent team-related daemon messages"],
            ["fleetlens team leave", "Unpair and stop team syncing"],
        ],
        [2.55 * inch, 4 * inch],
    )]
    story += [Spacer(1, 0.14 * inch), PageBreak()]
    story += [P("Pairing starts from the Team page", "H1Fleet")]
    story += [P(
        "Before pairing, the page gives the exact CLI command shape and reminds you that the admin must provide the token. After pairing, this page becomes the member's control surface for sync selection and status.",
    )]
    story += screenshot("team", "Figure 3. Team sync screen before pairing. After pairing it shows server, team, project selection, and last push state.")
    story += [PageBreak()]

    # Page 7
    story += [P("6. Understand the privacy boundary", "H1Fleet")]
    story += [P(
        "Fleetlens has two deliberately different operating modes. Keeping the boundary visible helps teams decide what to deploy and what to sync.",
    )]
    story += [table(
        ["Data", "Local Edition", "Team Edition sync"],
        [
            ["Raw transcripts", "Read locally by the parser", "Not uploaded"],
            ["Prompts and assistant responses", "Remain on the machine", "Not uploaded"],
            ["Absolute paths and file contents", "Used locally for parsing and signals", "Not uploaded"],
            ["Daily metrics", "Computed locally", "Shared for selected projects"],
            ["Rich project rollups", "Computed from local entries", "Shared as labeled aggregates"],
            ["Usage snapshots", "Stored in ~/.cclens/usage.jsonl", "Shared for the paired member"],
            ["AI enrichment", "Runs through the local claude CLI when enabled", "Enriched extras may be included in rollups"],
        ],
        [1.65 * inch, 2.4 * inch, 2.5 * inch],
    )]
    story += [Spacer(1, 0.18 * inch)]
    story += [callout(
        "Project selection is member-controlled",
        "The Team page shows which projects will sync. Exclude sensitive repositories before the first push. Leaving the team with <font name='Courier'>fleetlens team leave</font> stops future syncs.",
    )]
    story += [P("What the server needs", "H2Fleet")]
    story += [bullets([
        "A Postgres database for team membership, daily rollups, usage history, integrations, and server-side reports.",
        "A stable FLEETLENS_ENCRYPTION_KEY for protected server-side credentials and tokens.",
        "A public HTTPS URL for browser sign-in and CLI pairing. Railway and Google Cloud setup paths provide one automatically.",
    ])]
    story += [PageBreak()]

    # Page 8
    story += [P("7. Configuration and source builds", "H1Fleet")]
    story += [P("Most users do not need configuration. These are the supported knobs when the defaults do not fit.", "BodyFleet")]
    story += [table(
        ["Setting", "Default", "Use it when"],
        [
            ["CCLENS_PORT", "3321", "The default port is already in use"],
            ["CCLENS_HOME", "~/.cclens", "You need isolated local state for another workspace or test run"],
            ["GROK_HOME", "~/.grok", "Grok Build stores sessions or auth somewhere else"],
            ["NEXT_OUTPUT", "unset", "You are building the web app for the bundled CLI"],
        ],
        [1.25 * inch, 1.55 * inch, 3.75 * inch],
    )]
    story += [Spacer(1, 0.16 * inch)]
    story += [code_block("Choose another port", "fleetlens start --port 4400\n# or\nCCLENS_PORT=4400 fleetlens start")]
    story += [Spacer(1, 0.14 * inch)]
    story += [P("Build from source", "H2Fleet")]
    story += [code_block("Repository checkout", "git clone https://github.com/cowcow02/fleetlens.git\ncd fleetlens\npnpm install\nNEXT_OUTPUT=standalone pnpm build\nnode scripts/prepare-cli.mjs\nnode packages/cli/dist/index.js start")]
    story += [P(
        "The monorepo builds parser, entries, web, team-server, and CLI packages through Turborepo. For the published experience, the CLI package contains the standalone dashboard bundle.",
    )]
    story += [callout(
        "Versioning rule for contributors",
        "The root package.json is the version source of truth. Use npm version at the repository root so sub-package versions stay synchronized; do not edit package versions one by one.",
        bg=colors.HexColor("#f3f0ff"), accent=PURPLE,
    )]
    story += [PageBreak()]

    # Page 9
    story += [P("8. Troubleshooting", "H1Fleet")]
    story += [P("Use the symptom first, then run the smallest check that confirms the cause.", "BodyFleet")]
    story += [table(
        ["Symptom", "Check", "Next action"],
        [
            ["No sessions", "Confirm an agent has local transcript files; check the source path for that agent", "Run another agent session, then restart or refresh Fleetlens"],
            ["Server will not start", "fleetlens status and the port in the error", "Use fleetlens start --port 4400 or stop the old process"],
            ["No plan usage", "fleetlens daemon status; fleetlens daemon logs", "Log in to the provider CLI and wait for the next poll"],
            ["UI looks stale after update", "fleetlens status; compare the serving version", "Run fleetlens update, which restarts stale services cleanly"],
            ["Team is not syncing", "fleetlens team status and fleetlens team logs", "Finish /team/onboarding, select projects, then run fleetlens team sync"],
            ["Digests are empty", "Check entries in ~/.cclens and AI features in Settings", "Run a session, enable AI features, or backfill recent days"],
        ],
        [1.35 * inch, 2.35 * inch, 2.85 * inch],
    )]
    story += [Spacer(1, 0.18 * inch)]
    story += [P("Safe reset points", "H2Fleet")]
    story += [bullets([
        "Stopping Fleetlens does not delete transcript history or the local state directory.",
        "The local server and daemon are independent processes; fleetlens stop manages both, while fleetlens daemon stop only stops the worker.",
        "If a Team Edition server is unavailable, the local dashboard and local analytics continue to work. The daemon queues team payloads for retry where supported.",
    ])]
    story += [Spacer(1, 0.16 * inch)]
    story += [callout(
        "Still stuck?",
        "Capture the output of <font name='Courier'>fleetlens status</font>, <font name='Courier'>fleetlens daemon logs</font>, and the exact command you ran. Remove tokens and private paths before sharing a log in a public issue.",
        bg=colors.HexColor("#fff8e6"), accent=AMBER,
    )]
    story += [PageBreak()]

    # Page 10
    story += [P("9. Quick reference", "H1Fleet")]
    story += [P("The commands most users need after the first run.", "BodyFleet")]
    story += [table(
        ["Command", "Purpose"],
        [
            ["fleetlens start [--open]", "Start dashboard and usage daemon"],
            ["fleetlens stop", "Stop dashboard and usage daemon"],
            ["fleetlens status", "Show server, daemon, and latest snapshot"],
            ["fleetlens update", "Update to the latest published CLI"],
            ["fleetlens web [page] [--open]", "Open a dashboard page without starting the daemon"],
            ["fleetlens usage", "Print a current plan-utilization snapshot"],
            ["fleetlens usage --history", "Print daily token and cost history"],
            ["fleetlens entries --all", "Inspect day-scoped perception entries"],
            ["fleetlens digest day --yesterday", "Generate or read a day digest"],
            ["fleetlens digest week --last-week", "Generate or read a weekly digest"],
            ["fleetlens daemon logs", "Show recent daemon and sync logs"],
            ["fleetlens team status", "Show Team Edition pairing state"],
        ],
        [2.65 * inch, 3.9 * inch],
    )]
    story += [Spacer(1, 0.18 * inch)]
    story += [P("Where to go next", "H2Fleet")]
    story += [bullets([
        "Read the public platform documentation in the Fleetlens GitHub Pages site for architecture, data flow, deployment, and contributor notes.",
        "Open the repository README for release status, deployment links, and source-build details.",
        "Use the in-app Changelog icon to see user-facing changes in the installed build.",
    ])]
    story += [Spacer(1, 0.24 * inch)]
    story += [callout(
        "The one-line mental model",
        "Agent transcripts are local inputs. The parser turns them into common session data. Analytics and entries turn that data into useful views. The local dashboard reads those results; Team Edition receives only the rollups you choose to share.",
    )]
    story += [Spacer(1, 0.35 * inch), P(f"Fleetlens {VERSION} | reviewed {REVIEW_DATE}", "SmallFleet")]
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
        title="Fleetlens User Guide", author="Fleetlens",
    )
    doc.addPageTemplates([PageTemplate(id="fleetlens", frames=[frame], onPage=page_chrome)])
    doc.build(build_story())
    print(OUT)


if __name__ == "__main__":
    main()
