
FROM python:3.9-slim

# Setting working directory
WORKDIR /app

# Installing system dependencies for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copying requirements first for better caching
COPY requirements.txt .

# Debugging: Checking if requirements.txt is copied successfully
RUN ls -l && cat requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copying project files
COPY . .
# Creating a directory for the model if it doesn't exist
RUN mkdir -p TEST
ENV FLASK_APP=app.py
ENV FLASK_RUN_HOST=0.0.0.0
ENV FLASK_RUN_PORT=8080
EXPOSE 8080

# Using a healthcheck, for errors
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -f http://localhost:${PORT}/ || exit 1


CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 0 'app:app'
