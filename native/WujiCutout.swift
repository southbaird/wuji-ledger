import CoreImage
import Foundation
import Vision

private enum CutoutError: LocalizedError {
    case invalidArguments
    case unsupportedSystem
    case inputMissing(String)
    case noForeground
    case emptyImage
    case renderFailed

    var errorDescription: String? {
        switch self {
        case .invalidArguments:
            return "Usage: wuji-cutout <input-image> <output-png> or wuji-cutout --check"
        case .unsupportedSystem:
            return "Apple foreground cutout requires macOS 14 or later."
        case let .inputMissing(path):
            return "Input image does not exist: \(path)"
        case .noForeground:
            return "Apple Vision could not find a foreground subject in this image."
        case .emptyImage:
            return "Apple Vision returned an empty foreground image."
        case .renderFailed:
            return "Core Image could not render the sticker PNG."
        }
    }
}

private struct CapabilityResult: Codable {
    let available: Bool
    let engine: String
    let minimumSystem: String
}

private struct CutoutResult: Codable {
    let ok: Bool
    let outputPath: String
    let width: Int
    let height: Int
    let engine: String
}

private func writeJSON<T: Encodable>(_ value: T, to handle: FileHandle = .standardOutput) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(value)
    handle.write(data)
    handle.write(Data([0x0A]))
}

private func alphaMask(from image: CIImage) -> CIImage {
    let alphaVector = CIVector(x: 0, y: 0, z: 0, w: 1)
    return image.applyingFilter(
        "CIColorMatrix",
        parameters: [
            "inputRVector": alphaVector,
            "inputGVector": alphaVector,
            "inputBVector": alphaVector,
            "inputAVector": alphaVector,
        ]
    )
}

private func layer(color: CIColor, through mask: CIImage, over background: CIImage) -> CIImage {
    let foreground = CIImage(color: color).cropped(to: background.extent)
    return foreground.applyingFilter(
        "CIBlendWithAlphaMask",
        parameters: [
            kCIInputBackgroundImageKey: background,
            kCIInputMaskImageKey: mask,
        ]
    )
}

@available(macOS 14.0, *)
private func makeSticker(inputURL: URL, outputURL: URL) throws -> CutoutResult {
    let handler = VNImageRequestHandler(url: inputURL, options: [:])
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])

    guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
        throw CutoutError.noForeground
    }

    let pixelBuffer = try observation.generateMaskedImage(
        ofInstances: observation.allInstances,
        from: handler,
        croppedToInstancesExtent: true
    )
    let cutout = CIImage(cvPixelBuffer: pixelBuffer)
    guard !cutout.extent.isEmpty, cutout.extent.width > 1, cutout.extent.height > 1 else {
        throw CutoutError.emptyImage
    }

    // Scale the decoration with the subject while keeping it restrained on large photos.
    let shortestSide = min(cutout.extent.width, cutout.extent.height)
    let outlineRadius = min(18.0, max(4.0, shortestSide * 0.014))
    let shadowRadius = outlineRadius * 1.15
    let padding = ceil(outlineRadius * 3.6)
    let canvasRect = CGRect(
        x: 0,
        y: 0,
        width: ceil(cutout.extent.width + padding * 2),
        height: ceil(cutout.extent.height + padding * 2)
    )

    let transparent = CIImage(color: .clear).cropped(to: canvasRect)
    let subject = cutout
        .transformed(
            by: CGAffineTransform(
                translationX: padding - cutout.extent.minX,
                y: padding - cutout.extent.minY
            )
        )
        .composited(over: transparent)
        .cropped(to: canvasRect)

    let subjectMask = alphaMask(from: subject)
    let outlineMask = subjectMask
        .applyingFilter("CIMorphologyMaximum", parameters: ["inputRadius": outlineRadius])
        .cropped(to: canvasRect)

    let shadowMask = outlineMask
        .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: shadowRadius])
        .transformed(by: CGAffineTransform(translationX: outlineRadius * 0.18, y: -outlineRadius * 0.72))
        .cropped(to: canvasRect)

    let shadow = layer(
        color: CIColor(red: 0.08, green: 0.055, blue: 0.07, alpha: 0.24),
        through: shadowMask,
        over: transparent
    )
    let outline = layer(color: .white, through: outlineMask, over: shadow)
    let sticker = subject.composited(over: outline).cropped(to: canvasRect)

    let outputDirectory = outputURL.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)

    let context = CIContext(options: [
        .cacheIntermediates: false,
        .useSoftwareRenderer: false,
    ])
    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
        throw CutoutError.renderFailed
    }
    try context.writePNGRepresentation(
        of: sticker,
        to: outputURL,
        format: .RGBA8,
        colorSpace: colorSpace
    )

    return CutoutResult(
        ok: true,
        outputPath: outputURL.path,
        width: Int(canvasRect.width),
        height: Int(canvasRect.height),
        engine: "Apple Vision foreground instance mask"
    )
}

private func run() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    if arguments == ["--check"] {
        if #available(macOS 14.0, *) {
            try writeJSON(CapabilityResult(
                available: true,
                engine: "Apple Vision foreground instance mask",
                minimumSystem: "macOS 14.0"
            ))
        } else {
            try writeJSON(CapabilityResult(
                available: false,
                engine: "Apple Vision foreground instance mask",
                minimumSystem: "macOS 14.0"
            ))
        }
        return
    }

    guard arguments.count == 2 else {
        throw CutoutError.invalidArguments
    }
    guard #available(macOS 14.0, *) else {
        throw CutoutError.unsupportedSystem
    }

    let inputURL = URL(fileURLWithPath: arguments[0]).standardizedFileURL
    let outputURL = URL(fileURLWithPath: arguments[1]).standardizedFileURL
    guard FileManager.default.fileExists(atPath: inputURL.path) else {
        throw CutoutError.inputMissing(inputURL.path)
    }

    let result = try makeSticker(inputURL: inputURL, outputURL: outputURL)
    try writeJSON(result)
}

do {
    try run()
} catch {
    let message = error.localizedDescription
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
