#!/usr/bin/env python3
"""Builds index.html (the installable web app) from src/cal.html (the Claude artifact source).

Run after editing src/cal.html:  python3 build.py
"""
from pathlib import Path

root = Path(__file__).parent
page = (root / "src" / "cal.html").read_text()

head = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#fff7f9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1b1219" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Cal">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" sizes="180x180" href="icon-180.png?v=2">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<script src="standalone.js"></script>
</head>
<body>
"""

(root / "index.html").write_text(head + page + "\n</body>\n</html>\n")
print("wrote index.html")
