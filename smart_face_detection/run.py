import os
import sys

# Ensure the root project directory is in Python's search path
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT_DIR)

from Backend_Server.API.app import app, init_application

if __name__ == '__main__':
    # Initialize DB tables and load face recognition models
    init_application()
    
    print("\n" + "="*60)
    print("   AegisEye - AI Smart Face Detection Dashboard")
    print("   Host: http://127.0.0.1:5000")
    print("   Close the server using CTRL+C")
    print("="*60 + "\n")
    
    # Run the application
    app.run(debug=True, host='127.0.0.1', port=5000)
