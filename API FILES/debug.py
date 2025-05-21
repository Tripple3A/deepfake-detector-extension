import os
import io
import numpy as np
import cv2
import onnxruntime as ort
from flask import Flask, request, jsonify
import logging

# Configuring logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Suppressing TensorFlow logs 
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'

# Loading the ONNX model
onnx_model_path = "FinalModel.onnx"
ort_session = ort.InferenceSession(onnx_model_path)

app = Flask(__name__)

def preprocess_frame(frame):
    """Preprocess a single frame for model inference."""
    frame = cv2.resize(frame, (224, 224))  # Resizing to match model input
    frame = frame.transpose(2, 0, 1)  
    frame = frame.astype(np.float32) / 255.0  # Normalizing the images
    return np.expand_dims(frame, axis=0)

def detect_deepfake(video_bytes, filename="unknown"):
    """Process a video and detect deepfake frames."""
    logger.info(f"Processing video: {filename}")
    
    # Saving video to a temporary file
    temp_path = "temp_video.mp4"
    with open(temp_path, "wb") as f:
        f.write(video_bytes)
    
    # Opening the video file
    cap = cv2.VideoCapture(temp_path)
    if not cap.isOpened():
        os.remove(temp_path)
        logger.error(f"Cannot read video file: {filename}")
        return {"error": "Cannot read video file"}
    
    deepfake_frames = 0
    total_frames = 0
    

    prediction_values = []
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        total_frames += 1
        input_tensor = preprocess_frame(frame)
        
        # Runing inference
        output = ort_session.run(None, {'input.1': input_tensor})
        
        # Interpreting results
        prediction = output[0][0]
        prediction_values.append(float(prediction))
        
        if total_frames % 10 == 0:
            logger.info(f"Frame {total_frames}: prediction = {prediction}")
        
        if prediction > 0.5: 
            deepfake_frames += 1  # Frame is a deepfake
    
    cap.release()
    
    os.remove(temp_path)
    
    # Calculating some stats for debugging
    avg_prediction = np.mean(prediction_values) if prediction_values else 0
    min_prediction = np.min(prediction_values) if prediction_values else 0
    max_prediction = np.max(prediction_values) if prediction_values else 0
    
    logger.info(f"Video stats for {filename}:")
    logger.info(f"  Total frames: {total_frames}")
    logger.info(f"  Deepfake frames: {deepfake_frames}")
    logger.info(f"  Prediction stats - Avg: {avg_prediction:.4f}, Min: {min_prediction:.4f}, Max: {max_prediction:.4f}")
    
    deepfake_probability = deepfake_frames / total_frames if total_frames > 0 else 0
    is_deepfake = deepfake_probability > 0.5 
    
    result = {
        "deepfake": bool(is_deepfake),
        "confidence": float(deepfake_probability),
        "frames_analyzed": total_frames,
        "deepfake_frames": deepfake_frames,
        "avg_prediction": float(avg_prediction),
        "min_prediction": float(min_prediction),
        "max_prediction": float(max_prediction)
    }
    
    logger.info(f"Result: {result}")
    
    return result

@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        file = request.files.get('file')
        if file is None or file.filename == "":
            return jsonify({"error": "No file uploaded"})
        
        try:
            video_bytes = file.read()
            result = detect_deepfake(video_bytes, filename=file.filename)
            return jsonify(result)
        except Exception as e:
            logger.exception("Error processing video")
            return jsonify({"error": str(e)})
    
    return "Deepfake Detection API is running. Send a POST request with a video file to analyze."

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    logger.info(f"Starting server on port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)