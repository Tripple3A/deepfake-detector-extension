import os
import io
import numpy as np
import cv2
import onnxruntime as ort
from flask import Flask, request, jsonify
import logging
import base64
import time
import pymongo
import threading
import queue
from datetime import datetime
import uuid

# MongoDB connection
MONGO_URI = os.environ.get('MONGO_URI')
mongo_client = pymongo.MongoClient(MONGO_URI)


db = mongo_client['deepfake_detector'] 



# Tracking current model version
current_model_version = datetime.now().strftime("%Y%m%d%H%M%S")

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

# Adding CORS headers for API access from browser extension
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,X-Request-ID,Cache-Control,Pragma')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    return response




# Function to store frames for later training
def store_frame(frame, prediction):
    """Store a frame in the database for potential retraining"""
    try:
        # Compress image to JPEG
        success, img_encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not success:
            logger.warning("Failed to encode frame")
            return None
        
        # Convert to base64 for storage
        img_bytes = img_encoded.tobytes()
        img_base64 = base64.b64encode(img_bytes).decode('utf-8')
        
        # Generate a unique ID
        frame_id = str(uuid.uuid4())
        
        # Store in database
        db.frames.insert_one({
            "_id": frame_id,
            "data": img_base64,
            "prediction": float(prediction),
            "timestamp": datetime.now().isoformat(),
            "model_version": current_model_version
        })
        
        return frame_id
    except Exception as e:
        logger.exception(f"Error storing frame: {e}")
        return None




def preprocess_frame(frame):
    """Preprocess a single frame for model inference."""
    frame = cv2.resize(frame, (224, 224))  # Resize to match model input
    frame = frame.transpose(2, 0, 1)  # Convert to (3,224,224)
    frame = frame.astype(np.float32) / 255.0  # Normalize
    return np.expand_dims(frame, axis=0)


def detect_deepfake(video_bytes, filename="unknown"):
    """Process a video and detect deepfake frames."""
    logger.info(f"Processing video: {filename}")
    
    # Save video to a temporary file
    temp_path = "temp_video.mp4"
    with open(temp_path, "wb") as f:
        f.write(video_bytes)
    
    # Open the video file
    cap = cv2.VideoCapture(temp_path)
    if not cap.isOpened():
        # Clean up and return error
        os.remove(temp_path)
        logger.error(f"Cannot read video file: {filename}")
        return {"error": "Cannot read video file"}
    
    # For debugging, track all prediction values
    prediction_values = []
    frames_data = []  # To collect frame data
    
    try:
        # First pass - collect all predictions
        frame_count = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            input_tensor = preprocess_frame(frame)
            output = ort_session.run(None, {'input.1': input_tensor})
            prediction = float(output[0][0])
            prediction_values.append(prediction)
            
            # Only keep some frames (e.g., every 10th frame or up to 20 total)
            if frame_count % 10 == 0 or len(frames_data) < 20:
                # Convert to JPEG and base64 for storage
                success, img_encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if success:
                    img_bytes = img_encoded.tobytes()
                    img_base64 = base64.b64encode(img_bytes).decode('utf-8')
                    frames_data.append({
                        "data": img_base64,
                        "prediction": float(prediction)
                    })
            
            frame_count += 1
        
        # If no frames were processed, return error
        if not prediction_values:
            return {"error": "No frames could be analyzed in the video"}
        
        # Calculate statistics on all predictions
        avg_prediction = np.mean(prediction_values)
        min_prediction = np.min(prediction_values)
        max_prediction = np.max(prediction_values)
        
        # Set a fixed threshold based on observed patterns
        threshold = 0.8
        
        # Count frames with predictions below threshold as deepfakes
        deepfake_frames = sum(1 for p in prediction_values if p < threshold)
        total_frames = len(prediction_values)
        
        # Calculate the deepfake ratio
        deepfake_ratio = deepfake_frames / total_frames
        
        # Video is considered a deepfake if more than 50% of frames are classified as deepfakes
        is_deepfake = deepfake_ratio > 0.5
        
        # For confidence: distance from decision boundary (0.5) normalized to 0-1
        confidence = abs(deepfake_ratio - 0.5) * 2
        confidence = min(1.0, confidence)  # Cap at 1.0

        # After all your processing, before returning result, add this:
        stored_frame_ids = []
        for frame_data in frames_data:
            try:
            # Decode the frame
                img_bytes = base64.b64decode(frame_data["data"])
                frame = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
            
            # Store the frame and get its ID
                frame_id = store_frame(frame, frame_data["prediction"])
                if frame_id:
                    stored_frame_ids.append(frame_id)
            except Exception as e:
                logger.error(f"Error storing frame for feedback: {e}")
    
        logger.info(f"Stored {len(stored_frame_ids)} frames for potential feedback")
        
        # Log detailed information
        logger.info(f"Video analysis complete for {filename}:")
        logger.info(f"  Total frames: {total_frames}")
        logger.info(f"  Deepfake frames: {deepfake_frames}")
        logger.info(f"  Deepfake ratio: {deepfake_ratio:.4f}")
        logger.info(f"  Is deepfake: {is_deepfake}")
        logger.info(f"  Confidence: {confidence:.4f}")
        logger.info(f"  Fixed threshold used: {threshold}")
        logger.info(f"  Prediction stats - Avg: {avg_prediction:.4f}, Min: {min_prediction:.4f}, Max: {max_prediction:.4f}")
        
        # Return the result
        result = {
            "deepfake": bool(is_deepfake),
            "confidence": float(confidence),
            "deepfake_frames": deepfake_frames,
            "frames_analyzed": total_frames,
            "frames_data": frames_data,
             "frameIds": stored_frame_ids  # Include frames data for potential feedback use
        }
        
        return result
        
    except Exception as e:
        logger.exception(f"Error processing frame: {e}")
        return {"error": str(e)}
    finally:
        # Make sure to release the video capture
        cap.release()
        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)

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
            logger.exception("Error processing request")
            return jsonify({"error": str(e)})
    
    return "Deepfake Detection API is running. Send a POST request with a video file to analyze."


# Feedback endpoint 
@app.route('/feedback', methods=['POST'])
def receive_feedback():
    try:
        feedback_data = request.json
        logger.info(f"Received feedback: {feedback_data}")
        
        # Extract result from feedback data - handle both direct format and nested format
        if 'result' in feedback_data and isinstance(feedback_data['result'], dict):
            result = feedback_data['result']
            deepfake = result.get('deepfake', False)
            confidence = result.get('confidence', 0.0)
        else:
            # If result is not a nested object, look for direct fields
            deepfake = feedback_data.get('deepfake', False)
            confidence = feedback_data.get('confidence', 0.0)
        
        # Extract other fields with fallbacks for safety
        was_correct = feedback_data.get('wasCorrect', True)
        user_correction = feedback_data.get('userCorrection', None)
        
        # Handle frameIds which might be missing or named differently
        frame_ids = []
        if 'frameIds' in feedback_data:
            frame_ids = feedback_data['frameIds']
        elif 'frame_ids' in feedback_data:
            frame_ids = feedback_data['frame_ids']
            
        # Store in database with more robust error handling
        feedback_doc = {
            'timestamp': feedback_data.get('timestamp', datetime.now().isoformat()),
            'prediction': deepfake,
            'confidence': confidence,
            'was_correct': was_correct,
            'user_correction': user_correction,
            'frame_ids': frame_ids,
            'source': feedback_data.get('source', 'unknown')
        }
        
        feedback_id = db.feedbacks.insert_one(feedback_doc).inserted_id
        
        # Queue for retraining if incorrect and user provided a correction
        if not was_correct and user_correction is not None:
            logger.info(f"Stored feedback {feedback_id} with corrections for future training")
        
        return jsonify({'success': True, 'feedback_id': str(feedback_id)})
    except Exception as e:
        logger.exception(f"Error processing feedback: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# Modifying the analyze_frames endpoint to store frames and return frameIds
@app.route("/frames", methods=["POST"])
def analyze_frames():
    # Get the optional request ID from header for tracking
    request_id = request.headers.get('X-Request-ID', 'unknown')
    start_time = time.time()
    
    try:
        data = request.json
        if not data:
            logger.error(f"[{request_id}] No JSON data provided")
            return jsonify({"error": "No data provided"})
        
        frames_data = data.get('frames', [])
        if not frames_data:
            logger.error(f"[{request_id}] No frames provided in request")
            return jsonify({"error": "No frames provided"})
        
        # Extract batch information if available
        batch_info = data.get('batch_info', 'N/A')
        source = data.get('source', 'unknown')
        dimensions = data.get('dimensions', 'unknown')
        face_data = data.get('facial_frames', 0)
        
        logger.info(f"[{request_id}] Received analysis request from {source}: "
                   f"{len(frames_data)} frames, batch {batch_info}, dimensions {dimensions}, "
                   f"with {face_data} facial frames")
        
        total_frames = len(frames_data)
        prediction_values = []
        successful_frames = 0
        stored_frame_ids = []  # To track stored frame IDs for feedback
        
        # Track frames with faces separately if provided with facial frame information
        facial_prediction_values = []
        
        for i, frame_data in enumerate(frames_data):
            try:
                # Skip logging for each frame to reduce noise, but log progress every 25 frames
                if i % 25 == 0:
                    logger.debug(f"[{request_id}] Processing frame {i+1}/{total_frames}")
                
                # Converting base64 to image
                if ',' in frame_data:  # Handle data URI format
                    encoded_data = frame_data.split(',')[1]
                else:  # Already base64 without prefix
                    encoded_data = frame_data
                
                img_bytes = base64.b64decode(encoded_data)
                frame = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
                
                if frame is None:
                    logger.warning(f"[{request_id}] Failed to decode frame {i+1}")
                    continue
                
                # Processing frame using existing preprocessing function
                input_tensor = preprocess_frame(frame)
                output = ort_session.run(None, {'input.1': input_tensor})
                prediction = float(output[0][0].item())
                prediction_values.append(prediction)
                
                # Store frame in database for potential feedback
                frame_metadata = {
                    'source': source,
                    'dimensions': dimensions,
                    'request_id': request_id,
                    'has_face': i < face_data if face_data else False
                }
                
                frame_id = store_frame(frame, prediction)
                if frame_id:
                    stored_frame_ids.append(frame_id)
                
                successful_frames += 1
                
            except Exception as e:
                logger.error(f"[{request_id}] Error processing frame {i+1}: {str(e)}")
                # Continue processing other frames instead of failing
        
        # If no frames were successfully processed, return error
        if not prediction_values:
            logger.error(f"[{request_id}] No frames could be analyzed out of {total_frames} received")
            return jsonify({"error": "No frames could be analyzed"})
        
        processing_time = time.time() - start_time
        logger.info(f"[{request_id}] Processed {successful_frames}/{total_frames} frames in {processing_time:.2f} seconds")
        
        # Use the same logic as your video analysis for consistency
        avg_prediction = np.mean(prediction_values)
        min_prediction = np.min(prediction_values)
        max_prediction = np.max(prediction_values)
        
        # Same threshold and logic as your video function
        threshold = 0.8
        deepfake_frames = sum(1 for p in prediction_values if p < threshold)
        total_processed = len(prediction_values)
        deepfake_ratio = deepfake_frames / total_processed
        is_deepfake = deepfake_ratio > 0.5
        confidence = abs(deepfake_ratio - 0.5) * 2
        confidence = min(1.0, confidence)
        
        logger.info(f"[{request_id}] Analysis complete:")
        logger.info(f"  Total frames processed: {total_processed}/{total_frames}")
        logger.info(f"  Deepfake frames: {deepfake_frames}")
        logger.info(f"  Deepfake ratio: {deepfake_ratio:.4f}")
        logger.info(f"  Is deepfake: {is_deepfake}")
        logger.info(f"  Confidence: {confidence:.4f}")
        logger.info(f"  Prediction stats - Avg: {avg_prediction:.4f}, Min: {min_prediction:.4f}, Max: {max_prediction:.4f}")
        logger.info(f"  Stored {len(stored_frame_ids)} frames for potential feedback")
        
        # Return enhanced response for batch processing, now including frameIds
        return jsonify({
            "deepfake": bool(is_deepfake),
            "confidence": float(confidence),
            "deepfake_frames": deepfake_frames,
            "frames_analyzed": total_processed,
            "request_id": request_id,
            "processing_time": f"{processing_time:.2f}s",
            "frameIds": stored_frame_ids,  # Return the frame IDs for feedback
            "status": "success"
        })
    except Exception as e:
        processing_time = time.time() - start_time
        logger.exception(f"[{request_id}] Error in frames analysis: {e}")
        return jsonify({
            "error": str(e),
            "request_id": request_id,
            "processing_time": f"{processing_time:.2f}s",
            "status": "error"
        })

if __name__ == "__main__":

 


    # Getting port from environment variable (for Cloud Run, for deployment)
    port = int(os.environ.get("PORT", 8080))
    logger.info(f"Starting server on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)