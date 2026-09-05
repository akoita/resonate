FROM gcr.io/dataflow-templates-base/python312-template-launcher-base@sha256:60d33a62339e69cdc7212c65b9c6a43f493c5f252555b4007d1496749627fe07

WORKDIR /template

COPY requirements.lock .
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.lock

COPY analytics_transform.py main.py setup.py ./
RUN python -m pip install --no-cache-dir --no-build-isolation --no-deps .

ENV FLEX_TEMPLATE_PYTHON_PY_FILE="/template/main.py"
ENV FLEX_TEMPLATE_PYTHON_REQUIREMENTS_FILE="/template/requirements.lock"
ENV FLEX_TEMPLATE_PYTHON_SETUP_FILE="/template/setup.py"
ENV PYTHONPATH="/template"
