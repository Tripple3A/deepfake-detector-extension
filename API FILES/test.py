import requests
import json
import time

#  Current running port
API_URL = "http://127.0.0.1:8081"

# Testing both a fake and a real video, for model evaluation
#TEST_FAKE_VIDEO = "fake_23.mp4"
TEST_REAL_VIDEO = "fake_23.mp4"  

def test_video(video_path):
    print(f"\nTesting video: {video_path}")
    start_time = time.time()
    
    with open(video_path, "rb") as video_file:
        files = {"file": video_file}
        try:
            response = requests.post(API_URL, files=files, timeout=300)
            
            # Printing response status
            print(f"Response status code: {response.status_code}")
            
            # Parsing and printing the result
            result = response.json()
            elapsed_time = time.time() - start_time
            print(f"API Response (in {elapsed_time:.2f} seconds):")
            print(json.dumps(result, indent=2))
            
            if "error" in result:
                print(f"Test ERROR: {result['error']}")
                return None
                
            # Configuring the display of results
            print(f"Prediction: {'DEEPFAKE' if result['deepfake'] else 'AUTHENTIC'}")
            print(f"Confidence: {result['confidence']*100:.1f}%")
            print(f"Frames analyzed: {result['frames_analyzed']}")
            print(f"Deepfake frames: {result['deepfake_frames']}")
            
            return result
            
        except Exception as e:
            print(f"Test FAILED: {str(e)}")
            return None

if __name__ == "__main__":
    print(f"Testing API endpoint at {API_URL}")
    
    try:
        real_result = test_video(TEST_REAL_VIDEO)
    except FileNotFoundError:
        print(f"\nSkipping real video test - file not found: {TEST_REAL_VIDEO}")
        print("Update the TEST_REAL_VIDEO path in the script to test a real video.")