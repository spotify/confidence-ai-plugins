#!/usr/bin/env python3
"""Turn raw `braintrust eval` output into a compact per-skill markdown table."""
import re
import sys

SCORERS = [
    "ScopeClassification", "FlagShape", "PlanContent", "NamingRules",
    "Tone", "Communication", "EducateFirst", "Visualization",
]


def main() -> None:
    text = open(sys.argv[1]).read() if len(sys.argv) > 1 else sys.stdin.read()

    # Each summary block starts with "<experiment-name> compared to <base>:"
    # or just follows the SUMMARY banner; score lines look like
    # "96.43% 'Communication'       score" (optionally with a "(+1.2%)" diff).
    blocks = re.split(r"=+SUMMARY=+", text)[1:]
    rows = []
    for block in blocks:
        name_m = re.search(r"^([a-z]+)-full-skill\S*(?:\s+compared to\s+\S+)?:?", block.strip(), re.M)
        skill = name_m.group(1) if name_m else f"run{len(rows) + 1}"
        scores = {}
        for m in re.finditer(r"([\d.]+)%(?:\s*\(([-+][\d.]+)%\))?\s+'(\w+)'\s+score", block):
            val, diff, scorer = m.group(1), m.group(2), m.group(3)
            cell = f"{float(val):.0f}%"
            if diff and abs(float(diff)) >= 1:
                arrow = "↑" if float(diff) > 0 else "↓"
                cell += f" {arrow}{abs(float(diff)):.0f}"
            scores[scorer] = cell
        if scores:
            rows.append((skill, scores))

    if not rows:
        print("No eval summaries found in output.")
        return

    header = "| Skill | " + " | ".join(SCORERS) + " |"
    sep = "|" + "---|" * (len(SCORERS) + 1)
    print(header)
    print(sep)
    for skill, scores in rows:
        cells = [scores.get(s, "—") for s in SCORERS]
        print(f"| {skill} | " + " | ".join(cells) + " |")

    urls = re.findall(r"https://www\.braintrust\.dev\S+", text)
    if urls:
        print()
        print(f"[View details]({urls[-1]})")


if __name__ == "__main__":
    main()
