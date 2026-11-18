#!/usr/bin/env swift
//
// generate_icons.swift — render an SF Symbol into an Xcode imageset (macOS only).
//
//   swift generate_icons.swift <sf.symbol.name> <asset-name> [--output DIR] [--color HEX] [--size PX]
//
// Output: <asset-name>.imageset/ with @1x/@2x/@3x PNGs + Contents.json.
// SF Symbols are template images; --color tints them via source-atop compositing.
//
import AppKit

func fail(_ m: String) -> Never {
    FileHandle.standardError.write(Data("[ios-icon-gen] \(m)\n".utf8)); exit(1)
}

var args = Array(CommandLine.arguments.dropFirst())
guard let first = args.first else {
    fail("usage: generate_icons.swift <sf.symbol.name> <asset-name> [--output DIR] [--color HEX] [--size PX]")
}
if first == "--list" {
    print("Browse symbols in SF Symbols.app, then pass an exact name (e.g. doc.text.below.ecg).")
    exit(0)
}

let symbol = args.removeFirst()
guard let name = args.first, !name.hasPrefix("--") else { fail("missing <asset-name>") }
args.removeFirst()

var output = "."
var hex: String?
var size = 68
var i = 0
while i < args.count {
    switch args[i] {
    case "--output": guard i+1 < args.count else { fail("--output needs a value") }; output = args[i+1]; i += 2
    case "--color":  guard i+1 < args.count else { fail("--color needs a value") };  hex = args[i+1];   i += 2
    case "--size":   guard i+1 < args.count else { fail("--size needs a value") };   size = Int(args[i+1]) ?? size; i += 2
    default: fail("unknown arg: \(args[i])")
    }
}

func color(from raw: String) -> NSColor {
    var s = raw.hasPrefix("#") ? String(raw.dropFirst()) : raw
    if s.count == 6 { s += "FF" }
    guard s.count == 8, let v = UInt32(s, radix: 16) else { return .labelColor }
    return NSColor(srgbRed: CGFloat((v >> 24) & 0xff) / 255,
                   green:   CGFloat((v >> 16) & 0xff) / 255,
                   blue:    CGFloat((v >>  8) & 0xff) / 255,
                   alpha:   CGFloat(v & 0xff) / 255)
}

guard let base0 = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) else {
    fail("SF Symbol not found: \(symbol) (needs macOS; verify the name in SF Symbols.app)")
}
let dir = "\(output)/\(name).imageset"
do { try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true) }
catch { fail("cannot create output directory \(dir): \(error)") }

// Configure the symbol at the target pixel size per scale, so 2x/3x rasters are
// crisp rather than an upscaled 1x render.
func glyph(at px: Int) -> NSImage {
    let conf = NSImage.SymbolConfiguration(pointSize: CGFloat(px), weight: .regular)
    return base0.withSymbolConfiguration(conf) ?? base0
}

func writePNG(scale: Int) {
    let px = size * scale
    let canvas = NSImage(size: NSSize(width: px, height: px))
    canvas.lockFocus()
    let rect = NSRect(x: 0, y: 0, width: px, height: px)
    glyph(at: px).draw(in: rect)
    if let hex { color(from: hex).set(); rect.fill(using: .sourceAtop) }   // tint the template glyph
    canvas.unlockFocus()
    guard let tiff = canvas.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { fail("PNG encode failed at \(scale)x") }
    let suffix = scale == 1 ? "" : "@\(scale)x"
    let path = "\(dir)/\(name)\(suffix).png"
    do { try png.write(to: URL(fileURLWithPath: path)) } catch { fail("cannot write \(path): \(error)") }
}
[1, 2, 3].forEach(writePNG)

let contents = """
{
  "images" : [
    { "idiom" : "universal", "filename" : "\(name).png", "scale" : "1x" },
    { "idiom" : "universal", "filename" : "\(name)@2x.png", "scale" : "2x" },
    { "idiom" : "universal", "filename" : "\(name)@3x.png", "scale" : "3x" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
"""
do { try contents.write(toFile: "\(dir)/Contents.json", atomically: true, encoding: .utf8) }
catch { fail("cannot write Contents.json: \(error)") }
FileHandle.standardError.write(Data("[ios-icon-gen] wrote \(dir)\n".utf8))
