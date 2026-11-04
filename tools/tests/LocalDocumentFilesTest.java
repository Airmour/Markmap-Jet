import com.mohamedbamoh.markmap.utils.LocalDocumentFiles;
import java.nio.file.Files;
import java.nio.file.Path;

public final class LocalDocumentFilesTest {
    public static void main(String[] args) throws Exception {
        Path temp = Files.createTempDirectory("markmap-path-test-");
        Path root = Files.createDirectory(temp.resolve("doc"));
        Path sub = Files.createDirectory(root.resolve("images"));
        Path image = Files.writeString(sub.resolve("图 片.png"), "image");
        Path outside = Files.writeString(temp.resolve("outside.png"), "outside");
        Files.createSymbolicLink(root.resolve("outside-link.png"), outside);
        check(image.toRealPath().equals(LocalDocumentFiles.resolve(root, "images/%E5%9B%BE%20%E7%89%87.png")), "encoded Unicode path");
        check(image.toRealPath().equals(LocalDocumentFiles.resolve(root, "images/图%20片.png?x=1#part")), "query and fragment");
        for (String path : new String[]{"../outside.png", "%2e%2e/outside.png", "/etc/passwd", "file:///etc/passwd", "https://example.com/x.png", "//example.com/x.png", "outside-link.png", "missing.png", "images", "%"}) {
            check(LocalDocumentFiles.resolve(root, path) == null, "reject " + path);
        }
        try (var paths = Files.walk(temp)) {
            paths.sorted(java.util.Comparator.reverseOrder()).forEach(path -> {
                try { Files.delete(path); } catch (java.io.IOException e) { throw new RuntimeException(e); }
            });
        }
        System.out.println("Local document resource path checks passed");
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
