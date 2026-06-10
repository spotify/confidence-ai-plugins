from flask import Flask, request, jsonify
from os import environ
from dataclasses import dataclass

from openfeature import api
from openfeature.evaluation_context import EvaluationContext
from confidence.confidence import Confidence
from confidence.openfeature_provider import ConfidenceOpenFeatureProvider

app = Flask(__name__)


@dataclass
class AssignmentRequest:
    flag: str
    subject_key: str
    subject_attributes: dict
    assignment_type: str
    default_value: any


@app.route('/', methods=['GET'])
def health_check():
    return "OK"

@app.route('/sdk/reset', methods=['POST'])
def reset_sdk():
    initialize_client()

    return "Reset complete"

@app.route('/sdk/details', methods=['GET'])
def get_sdk_details():
    return jsonify({
        "sdkName": "python-sdk",
        "sdkVersion": "4.1.0",
        "supportsBandits": False,
        "supportsDynamicTyping": False
    })

@app.route('/flags/v1/assignment', methods=['POST'])
def handle_assignment():
    data = request.json
    request_obj = AssignmentRequest(
        flag=data['flag'],
        subject_key=data['subjectKey'],
        subject_attributes=data['subjectAttributes'],
        assignment_type=data['assignmentType'],
        default_value=data['defaultValue']
    )
    print(f"Request object: {request_obj}")

    client = api.get_client()
    context = EvaluationContext(
        targeting_key=request_obj.subject_key,
        attributes=request_obj.subject_attributes
    )

    try:
        match request_obj.assignment_type:
            case 'BOOLEAN':
                result = client.get_boolean_value(
                    request_obj.flag + ".enabled",
                    bool(request_obj.default_value),
                    context
                )
            case 'INTEGER':
                result = client.get_integer_value(
                    request_obj.flag + ".value",
                    int(request_obj.default_value),
                    context
                )
            case 'STRING':
                result = client.get_string_value(
                    request_obj.flag + ".value",
                    request_obj.default_value,
                    context
                )
            case 'NUMERIC':
                result = client.get_float_value(
                    request_obj.flag + ".value",
                    float(request_obj.default_value),
                    context
                )
            case 'JSON':
                result = client.get_object_value(
                    request_obj.flag,
                    request_obj.default_value,
                    context
                )

        response = {
            "result": result,
            "assignmentLog": [],
            "banditLog": [],
            "error": None
        }
        print(f"response: {response}")
        return jsonify(response)
    except Exception as e:
        print(f"Error processing assignment: {str(e)}")
        response = {
            "result": None,
            "assignmentLog": [],
            "banditLog": [],
            "error": str(e)
        }
        return jsonify(response)

def initialize_client():
    print("Initializing client")
    client_secret = environ.get('CONFIDENCE_CLIENT_SECRET', 'NOKEYSPECIFIED')

    confidence = Confidence(client_secret=client_secret)
    provider = ConfidenceOpenFeatureProvider(confidence)
    api.set_provider(provider)
    print("Client initialized")

if __name__ == "__main__":
    initialize_client()

    port = int(environ.get('SDK_RELAY_PORT', 7001))
    host = '0.0.0.0'
    print(f"Starting server on {host}:{port}")
    app.run(
        host=host,
        port=port,
        debug=True
    )
