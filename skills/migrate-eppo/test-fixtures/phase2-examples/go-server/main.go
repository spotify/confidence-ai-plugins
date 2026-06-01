package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/open-feature/go-sdk/openfeature"
	"github.com/spotify/confidence-resolver/openfeature-provider/go/confidence"
)

type AssignmentRequest struct {
	Flag              string                 `json:"flag"`
	SubjectKey        string                 `json:"subjectKey"`
	SubjectAttributes map[string]interface{} `json:"subjectAttributes"`
	AssignmentType    string                 `json:"assignmentType"`
	DefaultValue      interface{}            `json:"defaultValue"`
}

type AssignmentResponse struct {
	Result        interface{} `json:"result"`
	AssignmentLog []string    `json:"assignmentLog"`
	BanditLog     []string    `json:"banditLog"`
	Error         *string     `json:"error"`
}

type SDKDetails struct {
	SDKName               string `json:"sdkName"`
	SDKVersion            string `json:"sdkVersion"`
	SupportsBandits       bool   `json:"supportsBandits"`
	SupportsDynamicTyping bool   `json:"supportsDynamicTyping"`
}

var client *openfeature.Client

func initializeClient() error {
	clientSecret := os.Getenv("CONFIDENCE_CLIENT_SECRET")
	if clientSecret == "" {
		clientSecret = "NOKEYSPECIFIED"
	}

	provider, err := confidence.NewProvider(context.Background(), confidence.ProviderConfig{
		ClientSecret: clientSecret,
	})
	if err != nil {
		return fmt.Errorf("failed to create provider: %v", err)
	}

	openfeature.SetProviderAndWait(provider)
	client = openfeature.NewClient("go-sdk-relay")
	log.Printf("Confidence provider initialized successfully")
	return nil
}

func handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	fmt.Fprint(w, "OK")
}

func handleSDKDetails(w http.ResponseWriter, r *http.Request) {
	details := SDKDetails{
		SDKName:               "go-sdk",
		SDKVersion:            "6.1.0",
		SupportsBandits:       false,
		SupportsDynamicTyping: false,
	}
	json.NewEncoder(w).Encode(details)
}

func handleReset(w http.ResponseWriter, r *http.Request) {
	err := initializeClient()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	fmt.Fprint(w, "Reset complete")
}

func handleAssignment(w http.ResponseWriter, r *http.Request) {
	var req AssignmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Always prepare a response with default values
	response := AssignmentResponse{
		Result:        nil,
		AssignmentLog: []string{},
		BanditLog:     []string{},
	}

	if client == nil {
		errStr := "client not initialized"
		response.Error = &errStr
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	ctx := r.Context()
	evalCtx := openfeature.NewEvaluationContext(req.SubjectKey, req.SubjectAttributes)

	switch req.AssignmentType {
	case "BOOLEAN":
		defaultVal := false
		if v, ok := req.DefaultValue.(bool); ok {
			defaultVal = v
		} else if v, ok := req.DefaultValue.(float64); ok {
			defaultVal = v != 0
		}
		result, _ := client.BooleanValue(ctx, req.Flag+".enabled", defaultVal, evalCtx)
		response.Result = result

	case "STRING":
		defaultVal := ""
		if v, ok := req.DefaultValue.(string); ok {
			defaultVal = v
		}
		result, _ := client.StringValue(ctx, req.Flag+".value", defaultVal, evalCtx)
		response.Result = result

	case "NUMERIC":
		defaultVal := 0.0
		switch v := req.DefaultValue.(type) {
		case float64:
			defaultVal = v
		case int:
			defaultVal = float64(v)
		case string:
			defaultVal, _ = strconv.ParseFloat(v, 64)
		}
		result, _ := client.FloatValue(ctx, req.Flag+".value", defaultVal, evalCtx)
		response.Result = result

	case "INTEGER":
		defaultVal := int64(0)
		switch v := req.DefaultValue.(type) {
		case float64:
			defaultVal = int64(v)
		case int:
			defaultVal = int64(v)
		case int64:
			defaultVal = v
		}
		result, _ := client.IntValue(ctx, req.Flag+".value", defaultVal, evalCtx)
		response.Result = float64(result)

	case "JSON":
		result, _ := client.ObjectValue(ctx, req.Flag, req.DefaultValue, evalCtx)
		response.Result = result

	default:
		errStr := fmt.Sprintf("unsupported assignment type: %s", req.AssignmentType)
		response.Error = &errStr
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func main() {
	if err := initializeClient(); err != nil {
		log.Fatalf("Failed to initialize client: %v", err)
	}
	defer openfeature.Shutdown()

	http.HandleFunc("/", handleHealthCheck)
	http.HandleFunc("/sdk/details", handleSDKDetails)
	http.HandleFunc("/sdk/reset", handleReset)
	http.HandleFunc("/flags/v1/assignment", handleAssignment)

	port := os.Getenv("SDK_RELAY_PORT")
	if port == "" {
		port = "7001"
	}

	host := os.Getenv("SDK_RELAY_HOST")
	if host == "" {
		host = "0.0.0.0"
	}

	addr := fmt.Sprintf("%s:%s", host, port)
	log.Printf("Starting server on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
