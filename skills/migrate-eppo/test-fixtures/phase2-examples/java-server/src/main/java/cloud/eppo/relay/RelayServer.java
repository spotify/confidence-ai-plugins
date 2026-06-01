package cloud.eppo.relay;

import com.spotify.confidence.sdk.OpenFeatureLocalResolveProvider;
import dev.openfeature.sdk.Client;
import dev.openfeature.sdk.MutableContext;
import dev.openfeature.sdk.OpenFeatureAPI;
import dev.openfeature.sdk.Value;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

import static spark.Spark.*;

public class RelayServer {
    private static final Logger log = LoggerFactory.getLogger(RelayServer.class);
    private static final Gson gson = new Gson();
    private static Client client;

    public static void main(String[] args) {
        String host = System.getenv().getOrDefault("SDK_RELAY_HOST", "localhost");
        int portNum = Integer.parseInt(System.getenv().getOrDefault("SDK_RELAY_PORT", "4000"));
        String clientSecret = System.getenv().getOrDefault("CONFIDENCE_CLIENT_SECRET", "test-client-secret");

        // Set Spark host and port
        ipAddress(host);
        port(portNum);

        // Initialize Confidence client
        initializeClient(clientSecret);

        // Health check endpoint
        get("/", (req, res) -> {
            res.type("application/json");
            return "{\"status\":\"ok\"}";
        });

        // SDK details endpoint
        get("/sdk/details", (req, res) -> {
            res.type("application/json");
            JsonObject response = new JsonObject();
            response.addProperty("sdkName", "java-server-sdk");
            response.addProperty("sdkVersion", "5.2.0");
            response.addProperty("supportsBandits", false);
            response.addProperty("supportsDynamicTyping", false);
            return gson.toJson(response);
        });

        // Assignment endpoint
        post("/flags/v1/assignment", (req, res) -> {
            res.type("application/json");
            try {
                AssignmentRequest assignmentReq = gson.fromJson(req.body(), AssignmentRequest.class);

                MutableContext ctx = buildContext(assignmentReq.subjectKey, assignmentReq.subjectAttributes);

                Object result = getAssignment(assignmentReq, ctx);

                JsonObject response = new JsonObject();
                response.add("result", gson.toJsonTree(result));
                return gson.toJson(response);
            } catch (Exception e) {
                log.error("Assignment failed for request: {}", req.body(), e);
                res.status(500);
                JsonObject error = new JsonObject();
                error.addProperty("error", e.getMessage());
                return gson.toJson(error);
            }
        });

        // Reset SDK endpoint
        post("/sdk/reset", (req, res) -> {
            res.type("application/json");
            try {
                initializeClient(clientSecret);
                return "{}";
            } catch (Exception e) {
                log.error("SDK reset failed", e);
                res.status(500);
                JsonObject error = new JsonObject();
                error.addProperty("error", e.getMessage());
                return gson.toJson(error);
            }
        });

        System.out.println("Confidence Java Server SDK Relay listening on " + host + ":" + portNum);
    }

    private static void initializeClient(String clientSecret) {
        OpenFeatureLocalResolveProvider provider = new OpenFeatureLocalResolveProvider(clientSecret);
        OpenFeatureAPI.getInstance().setProviderAndWait(provider);
        client = OpenFeatureAPI.getInstance().getClient();
    }

    private static MutableContext buildContext(String subjectKey, Map<String, Object> attributesMap) {
        MutableContext ctx = new MutableContext(subjectKey);
        if (attributesMap != null) {
            for (Map.Entry<String, Object> entry : attributesMap.entrySet()) {
                Object value = entry.getValue();
                if (value instanceof Number) {
                    ctx.add(entry.getKey(), ((Number) value).doubleValue());
                } else if (value instanceof Boolean) {
                    ctx.add(entry.getKey(), (Boolean) value);
                } else if (value instanceof String) {
                    ctx.add(entry.getKey(), (String) value);
                } else if (value != null) {
                    throw new IllegalArgumentException(
                        "Unsupported attribute type for key '" + entry.getKey() + "': " + value.getClass().getName());
                }
            }
        }
        return ctx;
    }

    private static Object getAssignment(AssignmentRequest request, MutableContext ctx) {
        switch (request.assignmentType) {
            case "STRING":
                return client.getStringValue(
                    request.flag + ".value",
                    (String) request.defaultValue,
                    ctx
                );
            case "INTEGER":
                int defaultInt = request.defaultValue instanceof Number
                    ? ((Number) request.defaultValue).intValue()
                    : Integer.parseInt(request.defaultValue.toString());
                return client.getIntegerValue(
                    request.flag + ".value",
                    defaultInt,
                    ctx
                );
            case "BOOLEAN":
                boolean defaultBool = request.defaultValue instanceof Boolean
                    ? (Boolean) request.defaultValue
                    : Boolean.parseBoolean(request.defaultValue.toString());
                return client.getBooleanValue(
                    request.flag + ".enabled",
                    defaultBool,
                    ctx
                );
            case "NUMERIC":
                double defaultNumeric = request.defaultValue instanceof Number
                    ? ((Number) request.defaultValue).doubleValue()
                    : Double.parseDouble(request.defaultValue.toString());
                return client.getDoubleValue(
                    request.flag + ".value",
                    defaultNumeric,
                    ctx
                );
            case "JSON":
                // Eppo's getJSONStringAssignment returned a serialized String; Confidence
                // getObjectValue returns a structured Value, so no gson re-parse is needed.
                Value resolved = client.getObjectValue(request.flag, new Value(), ctx);
                return resolved.asObject();
            default:
                throw new IllegalArgumentException("Unknown assignment type: " + request.assignmentType);
        }
    }

    // Request DTO
    static class AssignmentRequest {
        String flag;
        String assignmentType;
        Object defaultValue;
        String subjectKey;
        Map<String, Object> subjectAttributes;
    }
}
