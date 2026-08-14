package agent

import (
	"bufio"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

// osName 讀取 /etc/os-release 的 PRETTY_NAME；失敗 fallback 至 runtime.GOOS。
func osName() string {
	f, err := os.Open("/etc/os-release")
	if err == nil {
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				v := strings.TrimPrefix(line, "PRETTY_NAME=")
				return strings.Trim(strings.TrimSpace(v), `"`)
			}
		}
	}
	return runtime.GOOS
}

// kernelVersion 讀取 /proc/version（如 "Linux version 5.15.0-... "）。
func kernelVersion() string {
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return ""
	}
	fields := strings.Fields(string(data))
	if len(fields) >= 3 {
		return fields[2]
	}
	return strings.TrimSpace(string(data))
}

// uptimeSeconds 讀取 /proc/uptime（秒）；失敗回 0。
func uptimeSeconds() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0
	}
	sec, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	return int64(sec)
}

// cpuInfo 回傳 CPU model（/proc/cpuinfo 第一筆 "model name"）。
func cpuInfo() string {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "model name") {
			idx := strings.Index(line, ":")
			if idx >= 0 {
				return strings.TrimSpace(line[idx+1:])
			}
		}
	}
	return ""
}

// memInfo 回傳記憶體摘要（如 "16GB total / 8GB available"）。
func memInfo() string {
	memTotal, memAvail := int64(0), int64(0)
	data, err := os.ReadFile("/proc/meminfo")
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				v, err := strconv.ParseInt(fields[1], 10, 64)
				if err != nil {
					continue
				}
				switch {
				case strings.HasPrefix(fields[0], "MemTotal"):
					memTotal = v
				case strings.HasPrefix(fields[0], "MemAvailable"):
					memAvail = v
				}
			}
		}
	}
	if memTotal <= 0 {
		return ""
	}
	return strconv.FormatInt(memTotal/1024/1024, 10) + "GB total / " +
		strconv.FormatInt(memAvail/1024/1024, 10) + "GB available"
}

// diskInfo 回傳根磁碟使用摘要（"<used>/<total> (<usage>%)"）。
func diskInfo() string {
	var st syscall.Statfs_t
	if err := syscall.Statfs("/", &st); err != nil {
		return ""
	}
	total := st.Blocks * uint64(st.Bsize)
	free := st.Bavail * uint64(st.Bsize)
	used := total - free
	if total == 0 {
		return ""
	}
	return strconv.FormatUint(used/1024/1024/1024, 10) + "GB / " +
		strconv.FormatUint(total/1024/1024/1024, 10) + "GB (" +
		strconv.FormatUint(used*100/total, 10) + "%)"
}
