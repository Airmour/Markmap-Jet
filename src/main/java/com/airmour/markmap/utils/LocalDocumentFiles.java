package com.airmour.markmap.utils;

import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;

/** Resolves relative document resources without escaping the document directory. */
public final class LocalDocumentFiles {
    private LocalDocumentFiles() { }

    public static Path resolve(Path documentDirectory, String raw) {
        try {
            URI uri = URI.create(raw);
            if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getPath() == null) return null;
            Path relative = Path.of(uri.getPath());
            if (relative.isAbsolute()) return null;
            for (Path part : relative) {
                if (part.toString().equals("..")) return null;
            }
            Path root = documentDirectory.toRealPath();
            Path resolved = root.resolve(relative).toRealPath();
            return resolved.startsWith(root) && Files.isRegularFile(resolved) ? resolved : null;
        } catch (IOException | IllegalArgumentException | SecurityException e) {
            return null;
        }
    }
}
