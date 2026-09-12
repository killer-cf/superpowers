# Oh My Pi (OMP) installation

## Prerequisite

Install [Oh My Pi](https://github.com/can1357/oh-my-pi) and make sure the `omp` command is available. After installing or linking Superpowers, restart OMP or start a new session.

This integration was verified with OMP `18.1.18`. This verification note sets no compatibility floor.

## Install from git

Install Superpowers directly from GitHub:

```bash
omp plugin install github:obra/superpowers
```

## Local development

From a checkout of Superpowers, link the plugin for local development:

```bash
omp plugin link /absolute/path/to/superpowers
```

Restart OMP or start a new session after linking so the native manifest and extension are loaded.

## Verify

Start a clean OMP session and send the acceptance prompt:

> Let's make a react todo list

The Superpowers bootstrap should load, and `brainstorming` auto-triggers before code. Confirm the plugin is visible with:

```bash
omp plugin list --json
omp plugin list
```

If the bootstrap does not load or the plugin is not listed, inspect the OMP logs in `~/.omp/logs/`.

## Remove

Uninstall the plugin with:

```bash
omp plugin uninstall superpowers
```
