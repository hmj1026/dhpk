#!/usr/bin/env bash
# iconify_gen.sh — search / preview / generate Xcode imagesets from the Iconify API.
#
#   iconify_gen.sh search  <query>
#   iconify_gen.sh preview <prefix:name>
#   iconify_gen.sh <prefix:name> <asset-name> [--output DIR] [--color HEX] [--size PX]
#
# Self-skips with a clear message when a required tool is absent (curl + an SVG
# rasterizer: rsvg-convert / cairosvg / inkscape). Output is a `<name>.imageset/`
# with @1x/@2x/@3x PNGs + Contents.json, ready to drop into an Xcode asset catalog.
set -euo pipefail

API="https://api.iconify.design"
SIZE_1X=68

die()  { echo "[ios-icon-gen] $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

have curl || die "curl not found — required for the Iconify API."

# rasterize <svg-file> <png-file> <px>  → 0 on success, 1 when no rasterizer exists
rasterize() {
    local svg="$1" png="$2" px="$3"
    if   have rsvg-convert; then rsvg-convert -w "$px" -h "$px" "$svg" -o "$png"
    elif have cairosvg;     then cairosvg "$svg" -o "$png" -W "$px" -H "$px"
    elif have inkscape;     then inkscape "$svg" --export-type=png --export-filename="$png" -w "$px" -h "$px" >/dev/null 2>&1
    else return 1; fi
}

urlenc() { printf '%s' "$1" | sed 's/ /%20/g'; }

cmd="${1:-}"; shift 2>/dev/null || true
case "$cmd" in
  search)
    q="${1:-}"; [ -n "$q" ] || die "usage: iconify_gen.sh search <query>"
    body="$(curl -fsSL "$API/search?query=$(urlenc "$q")&limit=40")" || die "search failed"
    if have python3; then
        printf '%s' "$body" | python3 -c 'import sys,json; [print(i) for i in json.load(sys.stdin).get("icons",[])]'
    else
        printf '%s\n' "$body"
    fi
    ;;
  preview)
    icon="${1:-}"; [ -n "$icon" ] || die "usage: iconify_gen.sh preview <prefix:name>"
    pfx="${icon%%:*}"; name="${icon#*:}"
    tmpdir="$(mktemp -d)"; trap 'rm -rf "$tmpdir"' EXIT
    tmp="$tmpdir/preview.svg"
    curl -fsSL "$API/$pfx/$name.svg?height=128" -o "$tmp" || die "icon not found: $icon"
    if   have qlmanage; then qlmanage -p "$tmp" >/dev/null 2>&1 &
    elif have open;     then open "$tmp"
    else echo "[ios-icon-gen] saved preview SVG: $tmp"; fi
    ;;
  ""|-h|--help)
    die "usage: iconify_gen.sh <search|preview|<prefix:name> <asset-name> [--output DIR] [--color HEX] [--size PX]>"
    ;;
  *)
    icon="$cmd"; name="${1:-}"
    [ -n "$name" ] || die "usage: iconify_gen.sh <prefix:name> <asset-name> [--output DIR] [--color HEX] [--size PX]"
    shift 2>/dev/null || true
    out="."; color=""; size="$SIZE_1X"
    while [ $# -gt 0 ]; do
        case "$1" in
            --output) [ -n "${2:-}" ] || die "--output requires a value"; out="$2"; shift 2;;
            --color)  [ -n "${2:-}" ] || die "--color requires a value"; color="$2"; shift 2;;
            --size)   [[ "${2:-}" =~ ^[0-9]+$ ]] || die "--size must be a positive integer"; size="$2"; shift 2;;
            *) die "unknown arg: $1";;
        esac
    done
    pfx="${icon%%:*}"; iname="${icon#*:}"
    query="?height=$((size*3))"
    [ -n "$color" ] && query="$query&color=%23${color#\#}"
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT; svg="$tmp/icon.svg"
    curl -fsSL "$API/$pfx/$iname.svg$query" -o "$svg" || die "icon not found: $icon"
    iset="$out/$name.imageset"; mkdir -p "$iset"
    for scale in 1 2 3; do
        px=$((size*scale)); suffix=""
        [ "$scale" -ne 1 ] && suffix="@${scale}x"
        rasterize "$svg" "$iset/$name$suffix.png" "$px" \
            || die "no SVG rasterizer found (install rsvg-convert / cairosvg / inkscape); SVG saved at $svg"
    done
    cat > "$iset/Contents.json" <<JSON
{
  "images" : [
    { "idiom" : "universal", "filename" : "$name.png", "scale" : "1x" },
    { "idiom" : "universal", "filename" : "$name@2x.png", "scale" : "2x" },
    { "idiom" : "universal", "filename" : "$name@3x.png", "scale" : "3x" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON
    echo "[ios-icon-gen] wrote $iset"
    ;;
esac
