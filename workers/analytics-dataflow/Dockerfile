FROM gcr.io/dataflow-templates-base/python312-template-launcher-base

WORKDIR /template

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY analytics_transform.py main.py ./

ENV FLEX_TEMPLATE_PYTHON_PY_FILE="/template/main.py"
ENV FLEX_TEMPLATE_PYTHON_REQUIREMENTS_FILE="/template/requirements.txt"
