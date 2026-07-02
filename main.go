// A webapp for looking at and searching through files.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"sync"
)

const scriptDescription = `
Usage: tailon-ng [options] <path> [<path> ...]

Tailon-ng is a webapp for searching through log files from your browser.
`

const scriptEpilog = `
Tailon-ng is configured entirely through command-line flags.

Each <path> is a file, a directory, or a shell glob, where "*" matches within a
directory and "**" across them (so "/var/log/**.log" finds .log files at any
depth). Directories are served recursively, and new files are picked up as they
appear. Several paths can be given as separate arguments or comma-separated.

Rotation leftovers (.gz, .bz2, .xz, .zst, .1, -YYYYMMDD, .old, .bak) are listed
but excluded from live tailing and plain grep. The web UI's grep-all mode also
searches them, decompressed transparently.

Example usage:
  tailon-ng /var/log/syslog /var/log/auth.log
  tailon-ng /var/log/nginx/,/var/log/apache/
  tailon-ng /var/log/remote/
  tailon-ng "/var/log/**.log"
  tailon-ng -b 127.0.0.1:8080 /var/log/messages
`

const scriptOptions = `  -b, --bind string            Address and port to listen on (default ":8080")
  -h, --help                   Show this help message and exit
  -r, --relative-root string   Webapp relative root (default "/")`

// gatherSources flattens the positional command-line arguments into a list of
// paths. Each argument may itself be a comma-separated list, so "tailon-ng a b"
// and "tailon-ng a,b" name the same two sources.
func gatherSources(args []string) []string {
	var sources []string
	for _, arg := range args {
		for _, s := range strings.Split(arg, ",") {
			if s = strings.TrimSpace(s); s != "" {
				sources = append(sources, s)
			}
		}
	}
	return sources
}

// Config contains all backend and frontend configuration options and relevant state.
type Config struct {
	RelativeRoot string
	BindAddr     []string

	Sources []string
}

// defaultConfig returns Tailon-ng's built-in configuration. There is no config
// file; settings come from command-line flags.
func defaultConfig() *Config {
	return &Config{
		RelativeRoot: "/",
		BindAddr:     []string{":8080"},
	}
}

var config = &Config{}

func main() {
	config = defaultConfig()

	var (
		printHelp bool
		bindAddr  = strings.Join(config.BindAddr, ",")
	)

	// The standard library flag package accepts both -name and --name. Register
	// a long and a short name for each option so that e.g. --bind and -b are
	// equivalent.
	flag.BoolVar(&printHelp, "help", false, "Show this help message and exit")
	flag.BoolVar(&printHelp, "h", false, "Show this help message and exit")
	flag.StringVar(&bindAddr, "bind", bindAddr, "Address and port to listen on")
	flag.StringVar(&bindAddr, "b", bindAddr, "Address and port to listen on")
	flag.StringVar(&config.RelativeRoot, "relative-root", config.RelativeRoot, "Webapp relative root")
	flag.StringVar(&config.RelativeRoot, "r", config.RelativeRoot, "Webapp relative root")

	flag.Usage = func() {
		fmt.Fprintln(os.Stderr, strings.TrimLeft(scriptDescription, "\n"))
		fmt.Fprintln(os.Stderr, scriptOptions)
		fmt.Fprintln(os.Stderr, strings.TrimRight(scriptEpilog, "\n"))
	}

	flag.Parse()

	if printHelp {
		flag.Usage()
		os.Exit(0)
	}

	config.BindAddr = strings.Split(bindAddr, ",")

	// Ensure that relative root is always '/' or '/$arg/'.
	config.RelativeRoot = "/" + strings.TrimLeft(config.RelativeRoot, "/")
	config.RelativeRoot = strings.TrimRight(config.RelativeRoot, "/") + "/"

	config.Sources = gatherSources(flag.Args())
	if len(config.Sources) == 0 {
		fmt.Fprintln(os.Stderr, "No paths specified on the command-line")
		os.Exit(2)
	}

	log.Print("Generate initial file listing")
	createListing(config.Sources)

	var wg sync.WaitGroup
	for _, addr := range config.BindAddr {
		wg.Add(1)
		go startServer(config, addr)
	}
	wg.Wait()

}

func startServer(config *Config, bindAddr string) {
	loggerHTML := log.New(os.Stdout, "", log.LstdFlags)
	loggerHTML.Printf("Server start, relative-root: %s, bind-addr: %s\n", config.RelativeRoot, bindAddr)

	server := setupServer(config, bindAddr, loggerHTML)

	if strings.Contains(bindAddr, ":") {
		server.ListenAndServe()
	} else {
		os.Remove(bindAddr)

		unixAddr, _ := net.ResolveUnixAddr("unix", bindAddr)
		unixListener, err := net.ListenUnix("unix", unixAddr)
		if err != nil {
			panic(err)
		}
		unixListener.SetUnlinkOnClose(true)

		defer unixListener.Close()
		server.Serve(unixListener)
	}
}
