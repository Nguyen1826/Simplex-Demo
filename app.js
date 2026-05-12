// --- LỚP XỬ LÝ SỐ CÓ CHỨA BIG-M ---
// Đại diện cho số có dạng: real + m * M
class BigMNum {
    constructor(real, m = 0) {
        this.real = new Fraction(real);
        this.m = new Fraction(m);
    }
    
    add(other) { return new BigMNum(this.real.add(other.real), this.m.add(other.m)); }
    sub(other) { return new BigMNum(this.real.sub(other.real), this.m.sub(other.m)); }
    mul(scalar) { return new BigMNum(this.real.mul(scalar), this.m.mul(scalar)); }
    div(scalar) { return new BigMNum(this.real.div(scalar), this.m.div(scalar)); }
    
    // So sánh: Ưu tiên hệ số m trước vì M là số cực kỳ lớn
    isGreaterThan(other) {
        if (!this.m.equals(other.m)) return this.m.compare(other.m) > 0;
        return this.real.compare(other.real) > 0;
    }
    isLessThan(other) {
        if (!this.m.equals(other.m)) return this.m.compare(other.m) < 0;
        return this.real.compare(other.real) < 0;
    }
    isGreaterThanOrEqual(other) { return !this.isLessThan(other); }
    isLessThanOrEqual(other) { return !this.isGreaterThan(other); }
    isZero() { return this.real.equals(0) && this.m.equals(0); }

    toString() {
        let rStr = this.real.toFraction(false);
        let mStr = this.m.toFraction(false);
        if (this.m.equals(0)) return rStr;
        if (this.real.equals(0)) {
            if (this.m.equals(1)) return "M";
            if (this.m.equals(-1)) return "-M";
            return mStr + "M";
        }
        let op = this.m.compare(0) > 0 ? "+" : "-";
        let absMStr = this.m.abs().equals(1) ? "M" : this.m.abs().toFraction(false) + "M";
        return `${rStr} ${op} ${absMStr}`;
    }
}

// --- BIẾN TOÀN CỤC & GIAO DIỆN ---
let constraintCount = 0;
let autoTimer = null;

function parseCoefficients(text) {
    return text.split(",").map(part => {
        const trimmed = part.trim();
        return new Fraction(trimmed === "" ? 0 : trimmed);
    });
}

function normalizeObjective(coefs, isMin) {
    return isMin ? coefs.map(c => c.mul(-1)) : coefs;
}

window.onload = () => {
    addConstraintRow("2, 4", "<=", "16");
    addConstraintRow("3, 2", "<=", "12");

    document.getElementById("start-btn").addEventListener("click", () => {
        startSimplex();
    });

    document.getElementById("step-btn").addEventListener("click", () => {
        stopAutoPlay();
        if (!state.matrix) {
            startSimplex();
            return;
        }
        runSimplexStep();
    });

    document.getElementById("auto-btn").addEventListener("click", () => {
        toggleAutoPlay();
    });

    document.getElementById("reset-btn").addEventListener("click", () => {
        resetSimplex();
    });
};

function addConstraintRow(coefs = "", sign = "<=", rhs = "") {
    constraintCount++;
    const div = document.createElement("div");
    div.className = "row mb-2 align-items-center constraint-row";
    div.innerHTML = `
        <div class="col-md-7">
            <input type="text" class="form-control coef-input" value="${coefs}" placeholder="Hệ số cách nhau dấu phẩy (VD: 2, 5, -1)">
        </div>
        <div class="col-md-2">
            <select class="form-select sign-input">
                <option value="<=" ${sign === "<=" ? "selected" : ""}>≤</option>
                <option value=">=" ${sign === ">=" ? "selected" : ""}>≥</option>
                <option value="=" ${sign === "=" ? "selected" : ""}>=</option>
            </select>
        </div>
        <div class="col-md-3">
            <input type="text" class="form-control rhs-input" value="${rhs}" placeholder="Hệ số tự do (VD: 18)">
        </div>
    `;
    document.getElementById("constraints-container").appendChild(div);
}

function removeConstraintRow() {
    const container = document.getElementById("constraints-container");
    if (container.children.length > 1) {
        container.removeChild(container.lastChild);
        constraintCount--;
    }
}

// --- LOGIC SIMPLEX ---
let state = {};

function startSimplex() {
    stopAutoPlay();
    document.getElementById("solution-container").innerHTML = ""; // Xóa KQ cũ
    
    // 1. Đọc dữ liệu từ form
    const optType = document.getElementById("optType").value.trim().toUpperCase();
    const objStr = document.getElementById("objFunc").value;
    const rawObjCoefs = parseCoefficients(objStr);
    
    // Chuyển Min thành Max
    let isMin = optType === "MIN";
    let objCoefs = normalizeObjective(rawObjCoefs, isMin);

    const rows = document.querySelectorAll(".constraint-row");
    let constraints = [];
    rows.forEach(row => {
        let coefs = parseCoefficients(row.querySelector(".coef-input").value);
        let sign = row.querySelector(".sign-input").value;
        let rhs = new Fraction(row.querySelector(".rhs-input").value);
        
        // Cân bằng số lượng biến
        while(coefs.length < objCoefs.length) coefs.push(new Fraction(0));
        
        // Đảm bảo hệ số tự do b >= 0
        if (rhs.compare(0) < 0) {
            coefs = coefs.map(c => c.mul(-1));
            rhs = rhs.mul(-1);
            sign = sign === "<=" ? ">=" : (sign === ">=" ? "<=" : "=");
        }
        constraints.push({ coefs, sign, rhs });
    });

    // 2. Khởi tạo Bảng (Tableau)
    let variables = [];
    for(let i=0; i<objCoefs.length; i++) variables.push({name: `x_{${i+1}}`, c: new BigMNum(objCoefs[i])});
    
    let slackCount = 1, artCount = 1;
    let basis = [];
    let initialMatrix = [];
    let bCol = [];

    constraints.forEach((cons, i) => {
        let rowData = [...cons.coefs.map(c => new BigMNum(c))];
        bCol.push(new BigMNum(cons.rhs));

        if (cons.sign === "<=") {
            let sName = `s_{${slackCount++}}`;
            variables.push({name: sName, c: new BigMNum(0)});
            basis.push(variables.length - 1); // Index của biến này trong variables
        } else if (cons.sign === ">=") {
            let sName = `s_{${slackCount++}}`;
            variables.push({name: sName, c: new BigMNum(0)});
            
            let aName = `a_{${artCount++}}`;
            variables.push({name: aName, c: new BigMNum(0, -1)}); // Hệ số hàm mục tiêu là -M
            basis.push(variables.length - 1);
        } else if (cons.sign === "=") {
            let aName = `a_{${artCount++}}`;
            variables.push({name: aName, c: new BigMNum(0, -1)}); // Hệ số -M
            basis.push(variables.length - 1);
        }
        initialMatrix.push(rowData);
    });

    // Điền 0 vào các ô trống trong initialMatrix cho vuông vắn
    initialMatrix.forEach((row, i) => {
        while(row.length < variables.length) row.push(new BigMNum(0));
        let type = constraints[i].sign;
        if (type === "<=") row[basis[i]] = new BigMNum(1);
        else if (type === ">=") {
            row[basis[i] - 1] = new BigMNum(-1); // s_i
            row[basis[i]] = new BigMNum(1);      // a_i
        } else if (type === "=") {
            row[basis[i]] = new BigMNum(1);
        }
    });

    state = {
        isMin,
        originalVarCount: objCoefs.length,
        variables,
        basis,
        matrix: initialMatrix,
        b: bCol,
        stepNum: 0,
        finished: false
    };

    runSimplexStep();
}

function calculateZjCj() {
    let Zj = [], CjZj = [];
    for(let j=0; j<state.variables.length; j++) {
        let sum = new BigMNum(0);
        for(let i=0; i<state.basis.length; i++) {
            let cB = state.variables[state.basis[i]].c;
            sum = sum.add(cB.mul(state.matrix[i][j].real));
        }
        Zj.push(sum);
        CjZj.push(state.variables[j].c.sub(sum));
    }
    
    // Tính Z (Tổng)
    let totalZ = new BigMNum(0);
    for(let i=0; i<state.basis.length; i++) {
        let cB = state.variables[state.basis[i]].c;
        totalZ = totalZ.add(cB.mul(state.b[i].real));
    }
    
    return { Zj, CjZj, totalZ };
}

function runSimplexStep() {
    if (!state.matrix || state.finished) return;

    let { Zj, CjZj, totalZ } = calculateZjCj();
    
    // 1. Tìm cột Pivot
    let pivotCol = -1;
    let maxCjZj = new BigMNum(0);
    
    for(let j=0; j<CjZj.length; j++) {
        if (CjZj[j].isGreaterThan(maxCjZj)) {
            maxCjZj = CjZj[j];
            pivotCol = j;
        }
    }

    let pivotRow = -1;
    let ratios = Array(state.basis.length).fill(null);
    
    if (pivotCol === -1) {
        state.finished = true;
        renderHTMLStep(Zj, CjZj, totalZ, -1, -1, ratios, true);
        renderFinalResult();
        stopAutoPlay();
        return;
    }

    // 2. Tìm hàng Pivot
    let minRatio = null;
    for(let i=0; i<state.matrix.length; i++) {
        let element = state.matrix[i][pivotCol].real;
        if (element.compare(0) > 0) {
            let ratio = state.b[i].real.div(element);
            ratios[i] = ratio;
            if (minRatio === null || ratio.compare(minRatio) < 0) {
                minRatio = ratio;
                pivotRow = i;
            }
        }
    }

    renderHTMLStep(Zj, CjZj, totalZ, pivotCol, pivotRow, ratios, false);

    if (pivotRow === -1) {
        state.finished = true;
        stopAutoPlay();
        alert("Bài toán vô nghiệm (Unbounded)!");
        return;
    }

    // 3. Biến đổi ma trận Gauss
    let nextMatrix = [];
    let nextB = [];
    let pivotElement = state.matrix[pivotRow][pivotCol].real;
    let leavingIndex = state.basis[pivotRow];

    for(let i=0; i<state.matrix.length; i++) {
        nextMatrix[i] = [];
        if (i === pivotRow) {
            // Hàng mới của Pivot = Hàng cũ / pivotElement
            for(let j=0; j<state.variables.length; j++) {
                nextMatrix[i][j] = state.matrix[i][j].div(pivotElement);
            }
            nextB[i] = state.b[i].div(pivotElement);
        } else {
            // Các hàng khác
            let factor = state.matrix[i][pivotCol].real;
            for(let j=0; j<state.variables.length; j++) {
                let subVal = state.matrix[pivotRow][j].div(pivotElement).mul(factor);
                nextMatrix[i][j] = state.matrix[i][j].sub(subVal);
            }
            let subB = state.b[pivotRow].div(pivotElement).mul(factor);
            nextB[i] = state.b[i].sub(subB);
        }
    }

    // Cập nhật State
    state.matrix = nextMatrix;
    state.b = nextB;
    state.basis[pivotRow] = pivotCol;
    state.stepNum++;

    // Nếu biến ảo rời khỏi basis thì loại bỏ cột tương ứng khỏi bảng
    let leavingVar = state.variables[leavingIndex];
    if (leavingVar && /^a_\{\d+\}$/.test(leavingVar.name)) {
        let stillInBasis = state.basis.includes(leavingIndex);
        if (!stillInBasis) {
            state.variables.splice(leavingIndex, 1);
            state.matrix = state.matrix.map(row => row.filter((_, j) => j !== leavingIndex));
            state.basis = state.basis.map(idx => (idx > leavingIndex ? idx - 1 : idx));
        }
    }
}

function renderFinalResult() {
    let finalMsg = `<h4>Final Result</h4><ul>`;
    let xValues = Array(state.originalVarCount).fill(null).map(() => new BigMNum(0));
    for(let i=0; i<state.basis.length; i++) {
        let vName = state.variables[state.basis[i]].name;
        let match = vName.match(/^x_\{(\d+)\}$/);
        if (match) {
            let idx = Number(match[1]) - 1;
            if (idx >= 0 && idx < xValues.length) {
                xValues[idx] = state.b[i];
            }
        }
    }
    for(let i=0; i<xValues.length; i++) {
        finalMsg += `<li>x<sub>${i + 1}</sub> = ${xValues[i].toString()}</li>`;
    }
    
    let { totalZ } = calculateZjCj();
    if(state.isMin) {
        let resF = totalZ.mul(-1).toString();
        finalMsg += `</ul><h5 class="text-success mt-2">Min F = ${resF}</h5>`;
    } else {
        finalMsg += `</ul><h5 class="text-success mt-2">Max S = ${totalZ.toString()}</h5>`;
    }

    let div = document.createElement("div");
    div.className = "alert alert-success mt-4 shadow-sm";
    div.innerHTML = finalMsg;
    document.getElementById("solution-container").appendChild(div);
}

function toggleAutoPlay() {
    if (autoTimer) {
        stopAutoPlay();
        return;
    }

    startSimplex();

    let speed = Number(document.getElementById("speed-select").value || 900);
    document.getElementById("auto-btn").textContent = "Pause";

    autoTimer = setInterval(() => {
        if (state.finished) {
            stopAutoPlay();
            return;
        }
        runSimplexStep();
    }, speed);
}

function stopAutoPlay() {
    if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
    }
    let autoBtn = document.getElementById("auto-btn");
    if (autoBtn) autoBtn.textContent = "Auto Play";
}

function resetSimplex() {
    stopAutoPlay();
    state = {};
    document.getElementById("solution-container").innerHTML = "";
    document.getElementById("optType").value = "MAX";
    document.getElementById("objFunc").value = "7, 6";
    const container = document.getElementById("constraints-container");
    container.innerHTML = "";
    constraintCount = 0;
    addConstraintRow("2, 4", "<=", "16");
    addConstraintRow("3, 2", "<=", "12");
}

// XUẤT RA GIAO DIỆN HTML
function renderHTMLStep(Zj, CjZj, totalZ, pCol, pRow, ratios, isOptimal) {
    let container = document.getElementById("solution-container");
    let isInitial = state.stepNum === 0 && !isOptimal;
    let stepTitle = isInitial ? "Initial Simplex Tableau" : `Simplex Iteration ${state.stepNum}`;
    let pivotVar = pCol >= 0 ? state.variables[pCol].name.replace(/_{(.*?)}/g, "<sub>$1</sub>") : "-";
    let leavingVar = pRow >= 0 ? state.variables[state.basis[pRow]].name.replace(/_{(.*?)}/g, "<sub>$1</sub>") : "-";
    let conversionNote = state.isMin ? "<span class=\"conversion-note\">Converted Min to Max by multiplying objective by -1</span>" : "";
    
    let html = `
    <div class="card p-3 shadow-sm step-card">
        <div class="d-flex flex-wrap align-items-center justify-content-between mb-2">
            <h5 class="step-title">${stepTitle} ${isOptimal ? "<span class='badge bg-success'>OPTIMAL</span>" : ""}</h5>
            <span class="text-muted">Step ${state.stepNum}</span>
        </div>
        <div class="table-responsive">
            <table class="table table-simplex table-bordered mt-2">
                <thead>
                    <tr>
                        <th rowspan="2" class="align-middle border-right-thick">Basis</th>
                        <th rowspan="2" class="align-middle border-right-thick">c<sub>B</sub></th>
    `;
    
    // In Header Variables (x1, x2, s1...)
    state.variables.forEach(v => {
        let name = v.name.replace(/_{(.*?)}/g, "<sub>$1</sub>");
        html += `<th>${name}</th>`;
    });

    html += `<th rowspan="2" class="border-left-thick border-right-thick">b</th><th rowspan="2">Ratio</th></tr>`;
    html += `<tr>`;
    state.variables.forEach(v => {
        html += `<th class="cj-head">${v.c.toString()}</th>`;
    });
    html += `</tr></thead><tbody>`;

    // In nội dung các hàng
    for(let i=0; i<state.basis.length; i++) {
        let v = state.variables[state.basis[i]];
        let vName = v.name.replace(/_{(.*?)}/g, "<sub>$1</sub>");
        let isRow = (i === pRow) ? "pivot-row" : "";
        
        html += `<tr class="${isRow}">
                    <th class="border-right-thick">${vName}</th>
                    <td class="border-right-thick">${v.c.toString()}</td>`;
        
        for(let j=0; j<state.variables.length; j++) {
            let isCol = (j === pCol) ? "pivot-col" : "";
            let isElem = (i === pRow && j === pCol) ? "pivot-element" : "";
            html += `<td class="${isCol}"><span class="${isElem}">${state.matrix[i][j].toString()}</span></td>`;
        }

        let ratioStr = ratios[i] !== null ? ratios[i].toFraction(false) : "---";
        let ratioClass = i === pRow && ratios[i] !== null ? "pivot-ratio" : "";
        html += `<td class="border-right-thick fw-bold">${state.b[i].toString()}</td>
             <td class="ratio-cell"><span class="${ratioClass}">${ratioStr}</span></td>
                 </tr>`;
    }

    // In hàng Zj và Cj - Zj
    html += `<tr><th colspan="2" class="text-end border-right-thick border-top-thick">Z<sub>j</sub></th>`;
    Zj.forEach(z => html += `<td class="border-top-thick">${z.toString()}</td>`);
    html += `<td class="fw-bold border-top-thick border-right-thick text-primary">${totalZ.toString()}</td><td></td></tr>`;

    html += `<tr class="cj-zj-row"><th colspan="2" class="text-end border-right-thick">C<sub>j</sub> - Z<sub>j</sub></th>`;
    CjZj.forEach((cz, idx) => {
        let maxClass = (idx === pCol) ? "text-danger fs-5" : "";
        html += `<td class="${maxClass}">${cz.toString()}</td>`;
    });
    html += `<td class="border-right-thick"></td><td></td></tr>`;

    html += `</tbody></table></div>`;

    html += `
        <div class="pivot-summary">
            <span><strong>Pivot column:</strong> ${pivotVar}</span>
            <span><strong>Pivot row:</strong> ${leavingVar}</span>
            <span><strong>Rule:</strong> choose the largest positive in C<sub>j</sub> - Z<sub>j</sub>, then the smallest positive ratio</span>
            ${conversionNote}
        </div>
    `;

    html += `</div>`;
    
    let div = document.createElement("div");
    div.innerHTML = html;
    container.appendChild(div);
}