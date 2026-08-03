FROM gcr.io/dataflow-templates-base/python312-template-launcher-base@sha256:c14942ea30b2eab6eba6202f27d9c3d591b6f4293083a7f86e81c2bd82ad6cf3

WORKDIR /template

COPY requirements.lock .
RUN python -m pip install --no-cache-dir --require-hashes -r requirements.lock

COPY analytics_transform.py main.py setup.py ./
RUN python -m pip install --no-cache-dir --no-build-isolation --no-deps .

ENV FLEX_TEMPLATE_PYTHON_PY_FILE="/template/main.py"
ENV FLEX_TEMPLATE_PYTHON_REQUIREMENTS_FILE="/template/requirements.lock"
ENV FLEX_TEMPLATE_PYTHON_SETUP_FILE="/template/setup.py"
ENV PYTHONPATH="/template"
